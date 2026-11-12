import type { Clock } from '#application/ports'
import type { EmailGateway, NotificationJournal } from '#application/notification/ports'
import { isEmailAddress, maskEmail } from '#domain/notification/email_message'

export interface EmailRequest {
  organizationId: string
  recipientUserId: string | null
  to: string
  toName?: string
  subject: string
  html: string
  text: string
  /** Corps ARCHIVÉ (par défaut : `text`). Obligatoire dès que le corps porte un secret. */
  journalBody?: string
  templateCode: string
  dedupKey: string | null
  payload?: Record<string, unknown>
}

export type EmailOutcome =
  | { status: 'sent'; notificationId: string; providerMessageId: string }
  | { status: 'duplicate' }
  | {
      status: 'failed'
      notificationId: string | null
      errorCode: string
      errorMessage: string
      retryable: boolean
    }

export type EmailWarning = (message: string, meta: Record<string, unknown>) => void

/**
 * =========================================================================
 *  SERVICE APPLICATIF — Envoyer un e-mail
 * =========================================================================
 *
 * Pendant de `SmsSender` pour le canal e-mail (Brevo), avec le même journal
 * (`notifications`, `channel = 'email'`) et la même idempotence
 * (`dedup_key`). Différence : pas de solde plateforme — Brevo facture selon
 * le forfait du compte, `sms_balance` ne concerne que les SMS.
 *
 *   ① ligne `notifications` (queued) ;
 *   ② appel Brevo, HORS transaction ;
 *   ③ `sent` + `messageId` Brevo, ou `failed` + motif.
 */
export class EmailSender {
  constructor(
    private readonly gateway: EmailGateway,
    private readonly journal: NotificationJournal,
    private readonly clock: Clock,
    private readonly warn: EmailWarning = () => {}
  ) {}

  async send(req: EmailRequest): Promise<EmailOutcome> {
    if (!isEmailAddress(req.to)) {
      return {
        status: 'failed',
        notificationId: null,
        errorCode: 'E_EMAIL_INVALID_RECIPIENT',
        errorMessage: 'Adresse e-mail invalide',
        retryable: false,
      }
    }

    // ---- ① réservation (une seule écriture : pas besoin de transaction)
    const reservation = await this.journal.reserve({
      channel: 'email',
      subject: req.subject,
      organizationId: req.organizationId,
      recipientUserId: req.recipientUserId,
      recipientAddress: req.to,
      templateCode: req.templateCode,
      body: req.journalBody ?? req.text,
      segments: 1,
      provider: this.gateway.provider,
      dedupKey: req.dedupKey,
      payload: req.payload,
    })
    if (!reservation) return { status: 'duplicate' }

    // ---- ② prestataire
    let result: Awaited<ReturnType<EmailGateway['send']>>
    try {
      result = await this.gateway.send({
        to: req.to,
        toName: req.toName,
        subject: req.subject,
        html: req.html,
        text: req.text,
        tags: [req.templateCode],
        reference: reservation.notificationId,
      })
    } catch (err) {
      // Issue inconnue : Brevo a peut-être accepté l'e-mail. Pas de nouvel essai.
      result = {
        ok: false,
        errorCode: 'E_EMAIL_GATEWAY_EXCEPTION',
        errorMessage: (err as Error).message,
        retryable: false,
      }
    }

    // ---- ③ issue
    const now = this.clock.now()
    if (result.ok) {
      await this.journal.markSent(reservation.notificationId, {
        providerMessageId: result.providerMessageId,
        segments: 1,
        at: now,
      })
      return {
        status: 'sent',
        notificationId: reservation.notificationId,
        providerMessageId: result.providerMessageId,
      }
    }

    await this.journal.markFailed(reservation.notificationId, {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      at: now,
    })
    this.warn('[email] envoi refusé par la passerelle', {
      provider: this.gateway.provider,
      templateCode: req.templateCode,
      to: maskEmail(req.to),
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    })
    return {
      status: 'failed',
      notificationId: reservation.notificationId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
    }
  }
}
