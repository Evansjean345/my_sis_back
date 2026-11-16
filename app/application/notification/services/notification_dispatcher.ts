import type { SmsSender } from '#application/notification/services/sms_sender'
import type { EmailSender } from '#application/notification/services/email_sender'
import type { ChannelMessage } from '#domain/notification/channel_messages'

export interface Delivery {
  organizationId: string
  recipientUserId: string | null
  /** Numéro E.164 (sms) ou adresse e-mail (email), selon `message.channel`. */
  to: string
  toName?: string
  message: ChannelMessage
  dedupKey: string | null
  payload?: Record<string, unknown>
}

export type DeliveryOutcome =
  | { status: 'sent'; notificationId: string; providerMessageId: string }
  | { status: 'duplicate' }
  | {
      status: 'failed'
      notificationId: string | null
      errorCode: string
      errorMessage: string
      retryable: boolean
    }

/**
 * =========================================================================
 *  RÉPARTITEUR PAR CANAL
 * =========================================================================
 *
 * Les cas d'usage et les handlers décrivent QUOI envoyer à QUI ; le canal du
 * message décide COMMENT : SMS → `SmsSender` (Twilio, solde plateforme),
 * e-mail → `EmailSender` (Brevo). Un nouveau canal (WhatsApp) s'ajoute ici,
 * sans toucher aux cas d'usage.
 */
export class NotificationDispatcher {
  constructor(
    private readonly sms: SmsSender,
    private readonly email: EmailSender
  ) {}

  async deliver(d: Delivery): Promise<DeliveryOutcome> {
    const m = d.message
    switch (m.channel) {
      case 'sms':
        return this.sms.send({
          organizationId: d.organizationId,
          recipientUserId: d.recipientUserId,
          to: d.to,
          body: m.body,
          journalBody: m.journalBody,
          templateCode: m.templateCode,
          dedupKey: d.dedupKey,
          payload: d.payload,
        })
      case 'email':
        return this.email.send({
          organizationId: d.organizationId,
          recipientUserId: d.recipientUserId,
          to: d.to,
          toName: d.toName,
          subject: m.subject,
          html: m.html,
          text: m.text,
          journalBody: m.journalBody,
          templateCode: m.templateCode,
          dedupKey: d.dedupKey,
          payload: d.payload,
        })
    }
  }
}
