import prisma from '../config/database.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../shared/common/errors.js';

const MAX_BODY = 4000;

function actorFromHeaders(req) {
  const tenantId = req.headers['x-tenant-id'] ? String(req.headers['x-tenant-id']) : null;
  const userId = req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null;
  const departmentId = req.headers['x-department-id'] ? String(req.headers['x-department-id']) : null;
  if (!tenantId || !userId) {
    throw new ValidationError('Tenant ID and User ID are required in headers');
  }
  return { tenantId, userId, departmentId };
}

function formatMessage(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    senderId: row.senderId,
    recipientId: row.recipientId,
    departmentId: row.departmentId ?? null,
    recipientDepartmentId: row.recipientDepartmentId ?? null,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    sender: row.sender
      ? {
          id: row.sender.id,
          firstName: row.sender.firstName,
          lastName: row.sender.lastName,
          email: row.sender.email,
        }
      : null,
    recipient: row.recipient
      ? {
          id: row.recipient.id,
          firstName: row.recipient.firstName,
          lastName: row.recipient.lastName,
          email: row.recipient.email,
        }
      : null,
  };
}

/**
 * GET /chat/colleagues — active users in the same agency (for direct messages).
 */
export async function listColleagues(req, res, next) {
  try {
    const { tenantId, userId } = actorFromHeaders(req);
    const users = await prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        departmentId: true,
        department: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    res.json({
      colleagues: users.map((u) => ({
        ...u,
        isSelf: u.id === userId,
      })),
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /chat/messages?channel=agency|dm&withUserId=&limit=&before=
 */
export async function getMessages(req, res, next) {
  try {
    const { tenantId, userId, departmentId } = actorFromHeaders(req);
    const channel = String(req.query.channel || 'agency').toLowerCase();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const before = req.query.before ? new Date(String(req.query.before)) : null;

    let where;
    if (channel === 'agency') {
      where = { tenantId, recipientId: null };
    } else if (channel === 'department') {
      if (!departmentId) throw new ValidationError('x-department-id header required for department channel');
      where = { tenantId, recipientId: null, departmentId };
    } else if (channel === 'dm') {
      const withUserId = req.query.withUserId ? String(req.query.withUserId) : null;
      if (!withUserId) throw new ValidationError('withUserId is required for direct messages');
      const peer = await prisma.user.findFirst({
        where: { id: withUserId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!peer) throw new NotFoundError('User');
      where = {
        tenantId,
        OR: [
          { senderId: userId, recipientId: withUserId },
          { senderId: withUserId, recipientId: userId },
        ],
      };
    } else {
      throw new ValidationError('channel must be agency, department, or dm');
    }

    if (before && !Number.isNaN(before.getTime())) {
      where = { AND: [where, { createdAt: { lt: before } }] };
    }

    const rows = await prisma.agencyChatMessage.findMany({
      where,
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, email: true } },
        recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({
      messages: rows.reverse().map(formatMessage),
      channel,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /chat/messages { body, recipientId? }
 */
export async function postMessage(req, res, next) {
  try {
    const { tenantId, userId, departmentId } = actorFromHeaders(req);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) throw new ValidationError('Message body is required');
    if (body.length > MAX_BODY) {
      throw new ValidationError(`Message must be at most ${MAX_BODY} characters`);
    }

    let recipientId = null;
    let recipientDepartmentId = null;
    if (req.body?.recipientId != null && req.body.recipientId !== '') {
      recipientId = String(req.body.recipientId);
      if (recipientId === userId) {
        throw new ValidationError('Cannot send a direct message to yourself; use the agency channel');
      }
      const peer = await prisma.user.findFirst({
        where: { id: recipientId, tenantId, isActive: true },
        select: { id: true, departmentId: true },
      });
      if (!peer) throw new NotFoundError('Recipient');
      recipientDepartmentId = peer.departmentId ?? null;
    }

    const sender = await prisma.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!sender) throw new ForbiddenError('Your account is not active in this agency');

    const channel = String(req.body?.channel || '').toLowerCase();
    const departmentBroadcast = !recipientId && channel === 'department';
    if (departmentBroadcast && !departmentId) {
      throw new ValidationError('x-department-id header required for department broadcast');
    }

    const row = await prisma.agencyChatMessage.create({
      data: {
        tenantId,
        senderId: userId,
        recipientId,
        departmentId: departmentBroadcast ? departmentId : null,
        recipientDepartmentId: recipientId ? recipientDepartmentId : null,
        body,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, email: true } },
        recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    res.status(201).json({ message: formatMessage(row) });
  } catch (e) {
    next(e);
  }
}
