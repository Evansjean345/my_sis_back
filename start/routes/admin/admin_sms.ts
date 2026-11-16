import router from '@adonisjs/core/services/router'

const SmsController = () => import('#presentation/http/controllers/notification/sms_controller')

/** Solde SMS de la plateforme et compte Twilio — périmètre PLATEFORME. */
export const adminSmsRoutes = () => {
  router
    .group(() => {
      router.get('/balance', [SmsController, 'balance'])
      router.post('/topup', [SmsController, 'topUp'])
    })
    .prefix('/sms')
}
