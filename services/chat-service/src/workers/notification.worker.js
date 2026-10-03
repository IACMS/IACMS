import { createConsumer, ensureTopicsExist, TOPICS } from '../config/kafka.js';
import * as presence from '../websocket/presence.js';
import * as pubsub from '../websocket/pubsub.js';
import prisma from '../config/database.js';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3008';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || 'internal-token-fallback';

let isRunning = false;
let consumer = null;

export async function start() {
  if (isRunning) return;
  isRunning = true;

  console.log('[notification-worker] Starting notification dispatcher...');

  // Ensure topics exist before subscribing
  await ensureTopicsExist([
    TOPICS.CHAT_MESSAGE_CREATED,
    TOPICS.CASE_ASSIGNED,
    TOPICS.CASE_UPDATED,
  ]);

  consumer = createConsumer('chat-worker-group-notifications');
  
  await consumer.connect();
  
  await consumer.subscribe({ topic: TOPICS.CHAT_MESSAGE_CREATED, fromBeginning: false });
  await consumer.subscribe({ topic: TOPICS.CASE_ASSIGNED, fromBeginning: false });
  await consumer.subscribe({ topic: TOPICS.CASE_UPDATED, fromBeginning: false });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        await processMessage(topic, payload);
        
        // Manual commit after successful processing
        await consumer.commitOffsets([
          { topic, partition, offset: (BigInt(message.offset) + 1n).toString() }
        ]);
      } catch (err) {
        console.error(`[notification-worker] Failed to process message from ${topic}:`, err.message);
        // Do not commit so it will retry, or we could handle DLQ.
      }
    },
  });
}

export async function stop() {
  isRunning = false;
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
  console.log('[notification-worker] Stopped.');
}

async function processMessage(topic, payload) {
  switch (topic) {
    case TOPICS.CHAT_MESSAGE_CREATED:
      await handleChatMessageCreated(payload);
      break;

    case TOPICS.CASE_ASSIGNED:
    case TOPICS.CASE_UPDATED:
      await handleCaseEvent(topic, payload);
      break;

    default:
      console.warn('[notification-worker] Unknown topic:', topic);
  }
}

async function handleChatMessageCreated(payload) {
  const data = payload.data || payload;
  let recipientIds = data.recipientIds;
  const conversationId = data.conversationId;

  if ((!recipientIds || recipientIds.length === 0) && conversationId && prisma?.chatParticipant?.findMany) {
    try {
      const participants = await prisma.chatParticipant.findMany({
        where: { conversationId, leftAt: null },
        select: { userId: true },
      });
      recipientIds = participants.map((p) => p.userId);
    } catch (e) {
      // Fallback ignore
    }
  }

  if (!recipientIds || recipientIds.length === 0) return;

  const { messageId, senderId, senderName, contentPreview, content } = data;
  const bodyText = contentPreview || content || 'Sent an attachment';

  // Check presence for all recipients in bulk
  const presenceMap = await presence.getBulkPresence(recipientIds);

  for (const recipientId of recipientIds) {
    // Skip if sender is the recipient
    if (recipientId === senderId) continue;

    const isOnline = presenceMap ? presenceMap.get(recipientId) : false;
    
    // Check if actively viewing the conversation
    const activeConv = await presence.getActiveConversation(recipientId);
    const isActivelyViewing = activeConv === conversationId;

    // Dispatch notification to notification-service for in-app storage, WebSocket fanout, and desktop push
    console.log(`[notification-worker] Dispatching notification for recipient ${recipientId} on message ${messageId}`);

    await sendNotificationServiceRequest({
      type: 'CHAT_MESSAGE',
      recipientId,
      title: `New message from ${senderName || 'Someone'}`,
      body: bodyText,
      data: { conversationId, messageId },
    });
  }
}

async function handleCaseEvent(topic, payload) {
  // Push real-time notification to the connected user
  const eventType = topic === TOPICS.CASE_ASSIGNED ? 'CASE_ASSIGNED' : 'CASE_UPDATED';
  const recipientId = payload.recipientId || payload.data?.assigneeId || payload.data?.userId;

  if (!recipientId) {
    console.warn('[notification-worker] Missing recipientId for case event');
    return;
  }

  // Generate an event ID if not present
  const eventId = payload.eventId || `evt_${Date.now()}`;

  // Broadcast through pubsub so the WebSocket server pushes it to the user
  await pubsub.publish({
    type: 'NOTIFICATION_CREATED',
    data: {
      recipientId,
      notificationId: payload.notificationId || eventId,
      notificationType: eventType,
      title: payload.title || (eventType === 'CASE_ASSIGNED' ? 'Case Assigned' : 'Case Updated'),
      body: payload.body || payload.data?.message || 'Check your case updates.',
      data: payload.data || {},
    },
  });
}

async function sendNotificationServiceRequest(payload) {
  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}/internal/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTERNAL_SERVICE_TOKEN}`,
        'x-internal-service-token': INTERNAL_SERVICE_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[notification-worker] Notification service responded with ${res.status}`);
    }
  } catch (err) {
    console.error(`[notification-worker] Failed to call notification service:`, err.message);
    throw err; // bubble up for retry
  }
}
