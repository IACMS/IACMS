import webpush from 'web-push';

export const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'REDACTED_VAPID_PUBLIC_KEY';

export const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || 'REDACTED_VAPID_PRIVATE_KEY';

export const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'mailto:support@iacms.gov';

try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && !VAPID_PUBLIC_KEY.startsWith('REDACTED_')) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }
} catch (e) {
  // Ignore in test / local development if invalid dummy keys are provided
}

export default webpush;
