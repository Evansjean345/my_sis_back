import router from '@adonisjs/core/services/router'
const DriverGroupController = () =>
  import('#presentation/http/controllers/fleet/driver_group_controller')

// ---- groupes de conducteurs — mêmes routes que les groupes de véhicules et de boîtiers
export const driverGroupRoutes = () => {
  router
    .group(() => {
      router.get('/', [DriverGroupController, 'index'])
      router.post('/', [DriverGroupController, 'store'])
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
