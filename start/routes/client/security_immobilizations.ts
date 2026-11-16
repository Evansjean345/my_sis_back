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

      /**
       * Immobilisation contrôlée d'un GROUPE : coupure / rétablissement
       * immédiats de chaque véhicule, garde-fous unitaires conservés.
       */
      router.post('/vehicle-groups/:id/immobilizations', [
        ImmobilizationController,
        'storeForGroup',
      ])
      router.post('/vehicle-groups/:id/restorations', [ImmobilizationController, 'restoreForGroup'])
    })
    .prefix('/security')
    .where('id', router.matchers.uuid())
    .use(throttle.sensitive)
}
