import router from '@adonisjs/core/services/router'
const VehicleGroupController = () =>
  import('#presentation/http/controllers/fleet/vehicle_group_controller')

// ---- groupes de véhicules
export const vehicleGroupRoutes = () => {
  router
    .group(() => {
      router.get('/', [VehicleGroupController, 'index'])
      router.post('/', [VehicleGroupController, 'store'])
      router.get('/:id', [VehicleGroupController, 'show'])
      router.patch('/:id', [VehicleGroupController, 'update'])
      router.delete('/:id', [VehicleGroupController, 'destroy'])
      router.get('/:id/vehicles', [VehicleGroupController, 'members'])
      router.post('/:id/vehicles', [VehicleGroupController, 'assign'])
      router.delete('/:id/vehicles/:memberId', [VehicleGroupController, 'unassign'])
      router.get('/:id/audit-logs', [VehicleGroupController, 'auditLogsOfGroup'])
    })
    .prefix('/vehicle-groups')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
