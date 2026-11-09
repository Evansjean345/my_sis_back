import type { OutboxHandler, OutboxHandlingResult, OutboxMessage } from '#application/ports'
import type { UserContact, UserContactReader } from '#application/identity/ports'
import type { SmsSender } from '#application/notification/services/sms_sender'
import { SmsTemplates, type RenderedSms } from '#domain/notification/sms_templates'

/*
Sujet d'envoi SMS lié à l'identité d'un utilisateur (création, suspension, réinitialisation de mot de passe).
*/
export const IDENTITY_SMS_TOPICS = [
  'identity.user.created',
  'identity.user.suspended',
  'identity.user.password_reset',
] as const

/**
 * =========================================================================
 *  HANDLER OUTBOX — SMS du cycle de vie d'un compte
 * =========================================================================
 *
 *   identity.user.created         → « votre compte a été créé »
 *   identity.user.suspended       → « votre compte a été suspendu »
 *   identity.user.password_reset  → « votre mot de passe a été modifié »
 *
 * Consommé par `node ace sisbm:outbox:dispatch` APRÈS le COMMIT : un compte
 * dont la création a échoué ne reçoit jamais de SMS (c'est la raison d'être
 * de l'outbox, cf. domain/identity/events.ts).
 *
 * Le compte est RELU au moment de l'envoi : les données de l'événement
 * peuvent avoir vieilli. Un compte supprimé, sans téléphone, ou réactivé
 * avant l'envoi du SMS de suspension est ignoré.
 *
 * Idempotence : `dedupKey = <topic>:<id outbox>`. Un message rejoué après
 * une panne entre l'envoi et l'acquittement ne part pas deux fois.
 */
export class IdentitySmsNotifications implements OutboxHandler {
  readonly name = 'identity-sms'
  readonly topics = IDENTITY_SMS_TOPICS

  constructor(
    private readonly users: UserContactReader,
    private readonly sms: SmsSender,
    private readonly config: { brand: string }
  ) {}

  /*
  Fonction de prise en main pour la gestion des sms liés à l'identité d'un utilisateur
  */
  async handle(message: OutboxMessage): Promise<OutboxHandlingResult> {
    const userId = message.aggregateId
    if (!userId) return { status: 'done' }

    const user = await this.users.findContactById(userId)
    if (!user?.phone) return { status: 'done' }

    const rendu = this.rendre(message.topic, user)
    if (!rendu) return { status: 'done' }

    const issue = await this.sms.send({
      organizationId: user.organizationId,
      recipientUserId: user.id,
      to: user.phone,
      body: rendu.body,
      journalBody: rendu.journalBody,
      templateCode: rendu.templateCode,
      dedupKey: `${message.topic}:${message.id}`,
      payload: { outboxId: message.id, topic: message.topic },
    })

    if (issue.status === 'failed' && issue.retryable) {
      return { status: 'retry', reason: `${issue.errorCode} : ${issue.errorMessage}` }
    }
    return { status: 'done' }
  }

  private rendre(topic: string, user: UserContact): RenderedSms | null {
    const brand = this.config.brand
    switch (topic) {
      case 'identity.user.created':
        return SmsTemplates.accountCreated({
          brand,
          fullName: user.fullName,
          email: user.email,
          locale: user.locale,
        })
      case 'identity.user.suspended':
        // Réactivé entre-temps : le SMS serait faux.
        if (user.status !== 'suspended') return null
        return SmsTemplates.accountSuspended({ brand, email: user.email, locale: user.locale })
      case 'identity.user.password_reset':
        return SmsTemplates.passwordChanged({ brand, locale: user.locale })
      default:
        return null
    }
  }
}
