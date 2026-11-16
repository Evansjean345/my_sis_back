import router from '@adonisjs/core/services/router'

const TwilioWebhookController = () =>
  import('#presentation/http/controllers/notification/twilio_webhook_controller')

/**
 * Webhooks ENTRANTS des prestataires. Publics (aucune session) : chacun
 * authentifie l'appelant par la signature propre au prestataire.
 */
export const webhookRoutes = () => {
  router
    .group(() => {
      router.post('/twilio/sms-status', [TwilioWebhookController, 'smsStatus'])
    })
    .prefix('/webhooks')
}
