import router from '@adonisjs/core/services/router'

const DeviceGroupController = () =>
  import('#presentation/http/controllers/fleet/device_group_controller')

export const adminDeviceGroupRoutes = () => {
  router
    .group(() => {
      // ---- groupes de boîtiers
      router.get('/', [DeviceGroupController, 'indexAll'])
      router.post('/', [DeviceGroupController, 'storeAll'])
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
