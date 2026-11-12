import { randomUUID } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import type {
  EmailGateway,
  EmailGatewayResult,
  OutgoingEmail,
} from '#application/notification/ports'
import { maskEmail } from '#domain/notification/email_message'

/**
 * Passerelle e-mail de DÉVELOPPEMENT (`MAIL_PROVIDER=log`) : l'e-mail (version
 * texte, code compris) est écrit dans la console, rien n'est envoyé.
 * Refusée en production. Pour envoyer de vrais e-mails en développement :
 * `MAIL_PROVIDER=brevo`.
 */
export class LogEmailGateway implements EmailGateway {
  readonly provider = 'log'

  constructor(private readonly inProduction: boolean) {}

  async send(email: OutgoingEmail): Promise<EmailGatewayResult> {
    if (this.inProduction) {
      return {
        ok: false,
        errorCode: 'E_EMAIL_LOG_DRIVER_IN_PRODUCTION',
        errorMessage: 'MAIL_PROVIDER=log est interdit en production',
        retryable: false,
      }
    }
    logger.info(
      { to: maskEmail(email.to) },
      `[email:log] → ${email.to} | ${email.subject}\n${email.text}`
    )
    return { ok: true, providerMessageId: `<LOG${randomUUID()}@sisbm.local>` }
  }
}
