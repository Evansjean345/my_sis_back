import router from '@adonisjs/core/services/router'
import { throttle } from '#start/limiter'
const ImmobilizationController = () =>
  import('#presentation/http/controllers/security/immobilization_controller')

export const SecurityAndImmobilizationRoutes = () => {
  // --------------------------------------------------------------- immobilisation
  router
    .group(() => {
      router.post('/immobilizations', [ImmobilizationController, 'store'])

      /**
       * Relance de l'émission d'une coupure restée `approved` (POST
       * /immobilizations émet déjà dans la foulée). Soumise à IMMOBILIZATION_ENABLED.
       */
      router.post('/immobilizations/:id/dispatch', [ImmobilizationController, 'dispatch'])

      /** Rétablissement du moteur : demande et émission en un appel. */
      router.post('/restorations', [ImmobilizationController, 'restore'])
    })
    .prefix('/security')
    .where('id', router.matchers.uuid())
    .use(throttle.sensitive)
}
