import router from '@adonisjs/core/services/router'
const OfferController = () => import('#presentation/http/controllers/billing/offer_controller')

/** Offres commerciales — catalogue et organisations détentrices (plateforme). */
export const adminOfferRoutes = () => {
  router
    .group(() => {
      router.get('/features', [OfferController, 'features'])
      router.get('/', [OfferController, 'index'])
      router.post('/', [OfferController, 'store'])
      router.get('/:id', [OfferController, 'show'])
      router.patch('/:id', [OfferController, 'update'])
      router.delete('/:id', [OfferController, 'destroy'])
      // organisations détentrices : rattacher (ou déplacer, move: true) / détacher
      router.post('/:id/organizations', [OfferController, 'attachOrganizations'])
      router.delete('/:id/organizations/:organizationId', [OfferController, 'detachOrganization'])
    })
    .prefix('/offers')
    .where('id', router.matchers.uuid())
    .where('organizationId', router.matchers.uuid())
}
