import router from '@adonisjs/core/services/router'
const SubscriptionAccessController = () =>
  import('#presentation/http/controllers/billing/subscription_access_controller')
const ClientSubscriptionController = () =>
  import('#presentation/http/controllers/billing/client_subscription_controller')

/**
 * Souscriptions vues depuis une organisation :
 *   - `/access` : pages ouvertes au compte connecté (tout compte) ;
 *   - le reste : souscriptions des flottes de l'organisation, gérées par son
 *     administrateur, client final (`subscription:read` / `subscription:write`).
 */
export const subscriptionRoutes = () => {
  router
    .group(() => {
      router.get('/access', [SubscriptionAccessController, 'access'])
      router.get('/offers', [ClientSubscriptionController, 'offers'])
      router.get('/', [ClientSubscriptionController, 'index'])
      router.post('/', [ClientSubscriptionController, 'store'])
      router.get('/:id', [ClientSubscriptionController, 'show'])
      router.patch('/:id', [ClientSubscriptionController, 'update'])
      router.post('/:id/status', [ClientSubscriptionController, 'changeStatus'])
      router.delete('/:id', [ClientSubscriptionController, 'destroy'])
    })
    .prefix('/subscriptions')
    .where('id', router.matchers.uuid())
}
