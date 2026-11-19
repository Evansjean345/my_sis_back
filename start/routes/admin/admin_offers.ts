import router from '@adonisjs/core/services/router'
const OfferController = () => import('#presentation/http/controllers/billing/offer_controller')

/** Offres commerciales et catalogue des fonctionnalités (plateforme). */
export const adminOfferRoutes = () => {
  router
    .group(() => {
      // catalogue : fonctionnalités → sous-fonctionnalités
      router.get('/features', [OfferController, 'features'])
      router.get('/', [OfferController, 'index'])
      router.post('/', [OfferController, 'store'])
      router.get('/:id', [OfferController, 'show'])
      router.patch('/:id', [OfferController, 'update'])
      router.delete('/:id', [OfferController, 'destroy'])
    })
    .prefix('/offers')
    .where('id', router.matchers.uuid())
}
