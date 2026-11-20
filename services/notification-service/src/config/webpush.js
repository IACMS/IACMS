import webpush from 'web-push';

export const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'REDACTED_VAPID_PUBLIC_KEY';

export const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || 'REDACTED_VAPID_PRIVATE_KEY';

export const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'mailto:support@iacms.gov';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export default webpush;
