import { randomUUID } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import type { OutgoingSms, SmsGateway, SmsGatewayResult } from '#application/notification/ports'
import { maskPhone, segmentSms } from '#domain/notification/sms_message'

/**
 * Passerelle de DÉVELOPPEMENT : écrit le SMS dans les journaux au lieu de
 * l'envoyer (`SMS_PROVIDER=log`). Permet de tester la réinitialisation sans
 * crédit Twilio — le code OTP apparaît dans la console.
 *
 * Refuse de fonctionner en production : un code OTP dans les journaux serait
 * lisible par toute personne ayant accès aux logs.
 */
export class LogSmsGateway implements SmsGateway {
  readonly provider = 'log'

  constructor(private readonly inProduction: boolean) {}

  /*
  Fonction d'envoi des logs pour les SMS.
  */
  async send(sms: OutgoingSms): Promise<SmsGatewayResult> {
    /*
    Ne pas envoyer les sms en production
    */
    if (this.inProduction) {
      return {
        ok: false,
        errorCode: 'E_SMS_LOG_DRIVER_IN_PRODUCTION',
        errorMessage: 'SMS_PROVIDER=log est interdit en production',
        retryable: false,
      }
    }
    /*
    Envoyer les sms en développement
    */
    logger.info({ to: maskPhone(sms.to) }, `[sms:log] → ${sms.to} : ${sms.body}`)
    return {
      ok: true,
      providerMessageId: `LOG${randomUUID().replaceAll('-', '')}`,
      providerStatus: 'logged',
      segments: segmentSms(sms.body).segments,
    }
  }
}
