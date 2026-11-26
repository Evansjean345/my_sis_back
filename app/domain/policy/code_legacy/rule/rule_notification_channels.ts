/**
 * RÈGLES — canaux d'envoi des notifications d'un événement : SMS, e-mail, push.
 * Le push est toujours inclus (`notificationChannels` dans rule_policy).
 */
export const NOTIFICATION_CHANNELS = ['sms', 'email', 'push'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]
