import type {
  EmailGateway,
  EmailGatewayResult,
  OutgoingEmail,
} from '#application/notification/ports'
import { BrevoApiError, type BrevoClient } from '#infrastructure/gateways/brevo/brevo_client'

export interface BrevoEmailConfig {
  /**
   * Expéditeur. L'adresse doit être un expéditeur VÉRIFIÉ dans Brevo
   * (Senders, Domains & Dedicated IPs), idéalement sur un domaine
   * authentifié (SPF + DKIM) : sinon Brevo refuse l'envoi ou les messages
   * finissent en indésirables.
   */
  fromEmail: string
  fromName: string
  /** Adresse de réponse (support) ; vide = pas de `replyTo`. */
  replyTo: string
}

/** POST /v3/smtp/email → 201 { messageId } */
interface BrevoSendResponse {
  messageId?: string
  messageIds?: string[]
}

/**
 * Adaptateur du port `EmailGateway` — e-mails transactionnels Brevo.
 * Ne lève jamais : toute issue devient un `EmailGatewayResult`.
 */
export class BrevoEmailGateway implements EmailGateway {
  readonly provider = 'brevo'

  constructor(
    private readonly client: BrevoClient,
    private readonly config: BrevoEmailConfig
  ) {}

  async send(email: OutgoingEmail): Promise<EmailGatewayResult> {
    if (!this.config.fromEmail) {
      return {
        ok: false,
        errorCode: 'E_EMAIL_NOT_CONFIGURED',
        errorMessage: 'MAIL_FROM_EMAIL requis',
        retryable: false,
      }
    }

    try {
      const r = await this.client.request<BrevoSendResponse>('POST', '/v3/smtp/email', {
        sender: { email: this.config.fromEmail, name: this.config.fromName },
        to: [{ email: email.to, ...(email.toName ? { name: email.toName } : {}) }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        ...(this.config.replyTo ? { replyTo: { email: this.config.replyTo } } : {}),
        ...(email.tags?.length ? { tags: email.tags } : {}),
        // En-tête personnalisé : retrouve la ligne `notifications` depuis Brevo.
        ...(email.reference ? { headers: { 'X-Sisbm-Ref': email.reference } } : {}),
      })
      const id = r.messageId ?? r.messageIds?.[0]
      if (!id) {
        return {
          ok: false,
          errorCode: 'brevo:no_message_id',
          errorMessage: 'Réponse Brevo sans messageId',
          retryable: false,
        }
      }
      return { ok: true, providerMessageId: id }
    } catch (err) {
      if (err instanceof BrevoApiError) {
        return {
          ok: false,
          errorCode:
            err.status === 0
              ? 'E_EMAIL_NOT_CONFIGURED'
              : `brevo:${err.brevoCode ?? `http_${err.status}`}`,
          errorMessage: err.brevoMessage,
          retryable: err.safeToRetry,
        }
      }
      // Délai dépassé ou coupure après l'envoi de la requête : issue inconnue.
      return {
        ok: false,
        errorCode: 'brevo:network',
        errorMessage: (err as Error).message,
        retryable: false,
      }
    }
  }
}
