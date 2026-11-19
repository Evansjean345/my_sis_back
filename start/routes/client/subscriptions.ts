import router from '@adonisjs/core/services/router'
const SubscriptionAccessController = () =>
  import('#presentation/http/controllers/billing/subscription_access_controller')

/**
 * Souscriptions de l'organisation du compte connecté, et pages qu'elles
 * ouvrent (menu du tableau de bord du distributeur).
 */
export const subscriptionRoutes = () => {
  router
    .group(() => {
      router.get('/access', [SubscriptionAccessController, 'access'])
      router.get('/', [SubscriptionAccessController, 'index'])
    })
    .prefix('/subscriptions')
}
