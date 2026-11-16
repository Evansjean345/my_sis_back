import router from '@adonisjs/core/services/router'

const DeviceGroupController = () =>
  import('#presentation/http/controllers/fleet/device_group_controller')

// ---- groupes de boîtiers
export const deviceGroupRoutes = () => {
  router
    .group(() => {
      router.get('/', [DeviceGroupController, 'index'])
      router.post('/', [DeviceGroupController, 'store'])
      router.get('/:id', [DeviceGroupController, 'show'])
      router.patch('/:id', [DeviceGroupController, 'update'])
      router.delete('/:id', [DeviceGroupController, 'destroy'])
      router.get('/:id/devices', [DeviceGroupController, 'members'])
      router.post('/:id/devices', [DeviceGroupController, 'assign'])
      router.delete('/:id/devices/:memberId', [DeviceGroupController, 'unassign'])
      router.get('/:id/audit-logs', [DeviceGroupController, 'auditLogsOfGroup'])
    })
    .prefix('/device-groups')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
