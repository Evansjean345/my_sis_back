import type { OutgoingSms, SmsGateway, SmsGatewayResult } from '#application/notification/ports'
import { TwilioApiError, type TwilioClient } from '#infrastructure/gateways/twilio/twilio_client'
import type { TwilioMessage } from '#infrastructure/gateways/twilio/twilio_types'

export interface TwilioSmsConfig {
  /**
   * Expéditeur : Sender ID alphanumérique (`SISBM`, 11 caractères max) ou
   * numéro Twilio E.164. En Côte d'Ivoire, le Sender ID doit être
   * PRÉ-ENREGISTRÉ auprès de Twilio : non enregistré, il est remplacé ou
   * le message n'est pas remis (erreur 30018).
   */
  from: string
  /** Prioritaire sur `from` : le Messaging Service choisit l'expéditeur. */
  messagingServiceSid: string
  /** URL publique du webhook d'accusés (`/api/v1/webhooks/twilio/sms-status`). */
  statusCallbackUrl: string
}

/**
 * Adaptateur du port `SmsGateway` — Twilio Programmable Messaging.
 *
 * Ne lève jamais : toute issue est traduite en `SmsGatewayResult`, et le
 * service d'envoi décide (journal, recrédit, nouvel essai).
 */
export class TwilioSmsGateway implements SmsGateway {
  readonly provider = 'twilio'

  constructor(
    private readonly client: TwilioClient,
    private readonly config: TwilioSmsConfig
  ) {}

  async send(sms: OutgoingSms): Promise<SmsGatewayResult> {
    if (!this.config.messagingServiceSid && !this.config.from) {
      return {
        ok: false,
        errorCode: 'E_SMS_NOT_CONFIGURED',
        errorMessage: 'TWILIO_FROM ou TWILIO_MESSAGING_SERVICE_SID requis',
        retryable: false,
      }
    }

    try {
      const message = await this.client.request<TwilioMessage>(
        'POST',
        this.client.accountPath('/Messages.json'),
        {
          form: {
            To: sms.to,
            Body: sms.body,
            ...(this.config.messagingServiceSid
              ? { MessagingServiceSid: this.config.messagingServiceSid }
              : { From: this.config.from }),
            StatusCallback: this.config.statusCallbackUrl || undefined,
          },
        }
      )
      const segments = Number.parseInt(message.num_segments, 10)
      return {
        ok: true,
        providerMessageId: message.sid,
        providerStatus: message.status,
        segments: Number.isFinite(segments) && segments > 0 ? segments : null,
      }
    } catch (err) {
      if (err instanceof TwilioApiError) {
        return {
          ok: false,
          errorCode: err.twilioCode ? `twilio:${err.twilioCode}` : `twilio:http_${err.status}`,
          errorMessage: err.twilioMessage,
          retryable: err.safeToRetry,
        }
      }
      // Délai dépassé ou coupure APRÈS l'envoi de la requête : issue inconnue.
      return {
        ok: false,
        errorCode: 'twilio:network',
        errorMessage: (err as Error).message,
        retryable: false,
      }
    }
  }
}
