import router from '@adonisjs/core/services/router'
const IncidentController = () =>
  import('#presentation/http/controllers/incident/incident_controller')

/** Incidents — tableau de bord de l'exploitant (toutes organisations, filtre `organizationId`). */
export const adminIncidentRoutes = () => {
  router
    .group(() => {
      router.get('/', [IncidentController, 'indexAll'])
      router.post('/', [IncidentController, 'storeAll'])
      router.get('/:id', [IncidentController, 'showAll'])
      router.patch('/:id/status', [IncidentController, 'statusAll'])
    })
    .prefix('/incidents')
    .where('id', router.matchers.uuid())
}
