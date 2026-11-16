import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import sisbmConfig from '#config/sisbm'
import { twilioStatusValidator } from '#presentation/http/validators/notification/sms_validators'
import { LucidNotificationJournal } from '#infrastructure/persistence/repositories/notification_repositories'
import { isValidTwilioSignature } from '#infrastructure/gateways/twilio/twilio_signature'
import type { DeliveryStatus } from '#application/notification/ports'

/** Statuts Twilio → statuts de `notifications`. Les autres sont intermédiaires. */
const STATUTS: Record<string, DeliveryStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
}

/**
 * =========================================================================
 *  WEBHOOK TWILIO — accusés de remise des SMS
 * =========================================================================
 *
 * POST /api/v1/webhooks/twilio/sms-status (public, SANS session).
 *
 * Seule protection : la signature `X-Twilio-Signature`, calculée avec l'Auth
 * Token sur l'URL CONFIGURÉE (`TWILIO_STATUS_CALLBACK_URL`). Sans Auth Token,
 * le webhook est fermé (404) : un accusé non signé pourrait marquer
 * « remis » un SMS qui ne l'a pas été.
 *
 * Répond toujours 204 à un appel authentique, même pour un SID inconnu :
 * Twilio réessaierait sinon un accusé qui ne correspondra jamais.
 */
@inject()
export default class TwilioWebhookController {
  constructor(private readonly journal: LucidNotificationJournal) {}

  async smsStatus(ctx: HttpContext) {
    const { authToken, statusCallbackUrl } = sisbmConfig.twilio
    if (!authToken || !statusCallbackUrl) return ctx.response.notFound()

    const params = ctx.request.body() as Record<string, unknown>
    const signature = ctx.request.header('x-twilio-signature')
    if (!isValidTwilioSignature(authToken, statusCallbackUrl, params, signature)) {
      logger.warn({ ip: ctx.request.ip() }, '[twilio] webhook : signature invalide')
      return ctx.response.forbidden({
        error: { code: 'E_INVALID_SIGNATURE', message: 'Signature Twilio invalide', details: {} },
      })
    }

    const accuse = await twilioStatusValidator.validate(params)
    const statut = STATUTS[accuse.MessageStatus]
    if (statut) {
      const trouve = await this.journal.applyDeliveryStatus(
        accuse.MessageSid,
        statut,
        new Date(),
        statut === 'failed'
          ? {
              errorCode: `twilio:${accuse.ErrorCode ?? accuse.MessageStatus}`,
              errorMessage: accuse.ErrorMessage ?? accuse.MessageStatus,
            }
          : undefined
      )
      if (!trouve) logger.warn({ sid: accuse.MessageSid }, '[twilio] accusé pour un SMS inconnu')
      if (statut === 'failed') {
        logger.warn(
          { sid: accuse.MessageSid, errorCode: accuse.ErrorCode },
          '[twilio] SMS non remis (30018 = Sender ID non enregistré pour ce réseau)'
        )
      }
    }
    return ctx.response.noContent()
  }
}
