import router from '@adonisjs/core/services/router'
const SubscriptionController = () =>
  import('#presentation/http/controllers/billing/subscription_controller')

/** Souscriptions : organisation × offre × flotte OU client final (plateforme). */
export const adminSubscriptionRoutes = () => {
  router
    .group(() => {
      router.get('/operators', [SubscriptionController, 'operators'])
      router.get('/', [SubscriptionController, 'index'])
      router.post('/', [SubscriptionController, 'store'])
      router.get('/:id', [SubscriptionController, 'show'])
      router.patch('/:id', [SubscriptionController, 'update'])
      // activer, suspendre, réactiver, résilier
      router.post('/:id/status', [SubscriptionController, 'changeStatus'])
      router.delete('/:id', [SubscriptionController, 'destroy'])
    })
    .prefix('/subscriptions')
    .where('id', router.matchers.uuid())
}
