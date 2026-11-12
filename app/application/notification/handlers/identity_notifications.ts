import type { OutboxHandler, OutboxHandlingResult, OutboxMessage } from '#application/ports'
import type { UserContact, UserContactReader } from '#application/identity/ports'
import type { NotificationDispatcher } from '#application/notification/services/notification_dispatcher'
import { SmsTemplates } from '#domain/notification/sms_templates'
import { ChannelMessages, type ChannelMessage } from '#domain/notification/channel_messages'

/*
Sujet d'envoi lié à l'identité d'un utilisateur (création, suspension, réinitialisation de mot de passe).
*/
export const IDENTITY_NOTIFICATION_TOPICS = [
  'identity.user.created',
  'identity.user.suspended',
  'identity.user.password_reset',
] as const

/**
 * =========================================================================
 *  HANDLER OUTBOX — notifications du cycle de vie d'un compte
 * =========================================================================
 *
 *   identity.user.created         → SMS « votre compte a été créé »
 *   identity.user.suspended       → SMS « votre compte a été suspendu »
 *   identity.user.password_reset  → « votre mot de passe a été modifié »,
 *                                   par le CANAL DU CODE utilisé (SMS ou
 *                                   e-mail, `payload.method`) : le titulaire
 *                                   est prévenu là où il vient d'agir.
 *
 * Consommé par `node ace sisbm:outbox:dispatch` APRÈS le COMMIT. Le compte
 * est RELU au moment de l'envoi ; un compte supprimé, sans adresse pour le
 * canal, ou réactivé avant l'envoi du message de suspension est ignoré.
 *
 * Idempotence : `dedupKey = <topic>:<id outbox>`.
 */
export class IdentityNotifications implements OutboxHandler {
  readonly name = 'identity-notifications'
  readonly topics = IDENTITY_NOTIFICATION_TOPICS

  constructor(
    private readonly users: UserContactReader,
    private readonly notifier: NotificationDispatcher,
    private readonly config: { brand: string }
  ) {}

  /*
  Fonction de prise en main pour la gestion des notifications liées à l'identité d'un utilisateur
  */
  async handle(message: OutboxMessage): Promise<OutboxHandlingResult> {
    const userId = message.aggregateId
    if (!userId) return { status: 'done' }

    const user = await this.users.findContactById(userId)
    if (!user) return { status: 'done' }

    const rendu = this.rendre(message, user)
    if (!rendu) return { status: 'done' }

    const to = rendu.channel === 'email' ? user.email : user.phone
    if (!to) return { status: 'done' }

    const issue = await this.notifier.deliver({
      organizationId: user.organizationId,
      recipientUserId: user.id,
      to,
      toName: user.fullName,
      message: rendu,
      dedupKey: `${message.topic}:${message.id}`,
      payload: { outboxId: message.id, topic: message.topic },
    })

    if (issue.status === 'failed' && issue.retryable) {
      return { status: 'retry', reason: `${issue.errorCode} : ${issue.errorMessage}` }
    }
    return { status: 'done' }
  }

  private rendre(message: OutboxMessage, user: UserContact): ChannelMessage | null {
    const brand = this.config.brand
    switch (message.topic) {
      case 'identity.user.created':
        return {
          channel: 'sms',
          ...SmsTemplates.accountCreated({
            brand,
            fullName: user.fullName,
            email: user.email,
            locale: user.locale,
          }),
        }
      case 'identity.user.suspended':
        // Réactivé entre-temps : le message serait faux.
        if (user.status !== 'suspended') return null
        return {
          channel: 'sms',
          ...SmsTemplates.accountSuspended({ brand, email: user.email, locale: user.locale }),
        }
      case 'identity.user.password_reset':
        return ChannelMessages.passwordChanged(
          message.payload.method === 'otp_email' ? 'email' : 'sms',
          { brand, fullName: user.fullName, locale: user.locale }
        )
      default:
        return null
    }
  }
}
