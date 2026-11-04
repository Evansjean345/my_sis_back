import router from '@adonisjs/core/services/router'
const UsageScheduleController = () =>
  import('#presentation/http/controllers/scheduling/usage_schedule_controller')

/**
 * Calendriers — tableau de bord d'administration. Liste et création : `*All` ;
 * le reste réutilise les fonctions client, dont la recherche est ouverte au joker `*`.
 */
export const adminUsageScheduleRoutes = () => {
  router
    .group(() => {
      router.get('/', [UsageScheduleController, 'indexAll'])
      router.post('/', [UsageScheduleController, 'storeAll'])
      router.get('/:id', [UsageScheduleController, 'show'])
      router.patch('/:id', [UsageScheduleController, 'update'])
      router.delete('/:id', [UsageScheduleController, 'destroy'])
      router.put('/:id/windows', [UsageScheduleController, 'replaceWindows'])
      router.get('/:id/preview', [UsageScheduleController, 'preview'])
      router.get('/:id/vehicles', [UsageScheduleController, 'vehicles'])
      router.post('/:id/vehicles', [UsageScheduleController, 'attachVehicles'])
      router.delete('/:id/vehicles/:memberId', [UsageScheduleController, 'detachVehicle'])
      router.get('/:id/vehicle-groups', [UsageScheduleController, 'groups'])
      router.post('/:id/vehicle-groups', [UsageScheduleController, 'attachGroups'])
      router.delete('/:id/vehicle-groups/:memberId', [UsageScheduleController, 'detachGroup'])
    })
    .prefix('/usage-schedules')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
