import router from '@adonisjs/core/services/router'
const DriverController = () => import('#presentation/http/controllers/fleet/driver_controller')
const DriverGroupController = () =>
  import('#presentation/http/controllers/fleet/driver_group_controller')

export const adminDriverRoutes = () => {
  router
    .group(() => {
      router.get('/', [DriverController, 'indexAll'])
      router.post('/', [DriverController, 'storeAll'])
      router.get('/:id', [DriverController, 'show'])
      router.patch('/:id', [DriverController, 'update'])
      router.delete('/:id', [DriverController, 'destroy'])
      router.put('/:id/vehicle', [DriverController, 'assignVehicle'])
    })
    .prefix('/drivers')
    .where('id', router.matchers.uuid())

  router
    .group(() => {
      router.get('/', [DriverGroupController, 'indexAll'])
      router.post('/', [DriverGroupController, 'storeAll'])
      router.get('/:id', [DriverGroupController, 'show'])
      router.patch('/:id', [DriverGroupController, 'update'])
      router.delete('/:id', [DriverGroupController, 'destroy'])
      router.get('/:id/drivers', [DriverGroupController, 'members'])
      router.post('/:id/drivers', [DriverGroupController, 'assign'])
      router.delete('/:id/drivers/:memberId', [DriverGroupController, 'unassign'])
      router.get('/:id/audit-logs', [DriverGroupController, 'auditLogsOfGroup'])
    })
    .prefix('/driver-groups')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
