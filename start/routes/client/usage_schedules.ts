import router from '@adonisjs/core/services/router'
const UsageScheduleController = () =>
  import('#presentation/http/controllers/scheduling/usage_schedule_controller')

/**
 * Calendriers d'utilisation et immobilisation planifiée.
 *
 * Lecture : `vehicle:read`. Écriture et rattachement : `policy:write` (admin,
 * super_admin) — programmer des coupures automatiques est plus engageant
 * qu'une coupure ponctuelle.
 */
export const usageScheduleRoutes = () => {
  router
    .group(() => {
      router.get('/', [UsageScheduleController, 'index'])
      router.post('/', [UsageScheduleController, 'store'])
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

  // Vues depuis le véhicule et le groupe : là où l'opérateur les cherche.
  router
    .get('/vehicles/:id/schedule-status', [UsageScheduleController, 'vehicleStatus'])
    .where('id', router.matchers.uuid())
  router
    .get('/vehicle-groups/:id/schedules', [UsageScheduleController, 'groupSchedules'])
    .where('id', router.matchers.uuid())
}
