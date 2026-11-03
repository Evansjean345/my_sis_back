import router from '@adonisjs/core/services/router'
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')
const AuditLogController = () => import('#presentation/http/controllers/audit/audit_log_controller')
const VehicleGroupController = () =>
  import('#presentation/http/controllers/fleet/vehicle_group_controller')
const DeviceGroupController = () =>
  import('#presentation/http/controllers/fleet/device_group_controller')

export const organizationRoutes = () => {
  router.get(
    '/organization',
    '#presentation/http/controllers/identity/organization_controller.current'
  )

  router
    .group(() => {
      router.get('/', [OrganizationController, 'index'])
      router.post('/', [OrganizationController, 'store'])
      router.get('/:id', [OrganizationController, 'show'])
      router.patch('/:id', [OrganizationController, 'update'])

      // ---- comptes rattachés à l'organisation
      router.get('/:id/users', [OrganizationController, 'users'])
      router.post('/:id/users', [OrganizationController, 'storeUser'])
      router.get('/:id/roles', [OrganizationController, 'roles'])

      // ---- journal d'audit de l'organisation
      router.get('/:id/audit-logs', [AuditLogController, 'byOrganization'])

      /**
       * Groupes créés POUR une organisation désignée. Les mêmes contrôleurs
       * servent les routes auto-portées ci-dessous : `:organizationId` est lu
       * par `organizationScope()`, qui le refuse à qui n'a pas le joker `*`.
       */
      router
        .group(() => {
          // Noms explicites : ces routes partagent leurs contrôleurs avec les
          // routes auto-portées, et AdonisJS refuse deux noms générés identiques.
          router
            .get('/vehicle-groups', [VehicleGroupController, 'index'])
            .as('organizations.vehicleGroups.index')
          router
            .post('/vehicle-groups', [VehicleGroupController, 'store'])
            .as('organizations.vehicleGroups.store')
          router
            .get('/device-groups', [DeviceGroupController, 'index'])
            .as('organizations.deviceGroups.index')
          router
            .post('/device-groups', [DeviceGroupController, 'store'])
            .as('organizations.deviceGroups.store')
        })
        .prefix('/:organizationId')
        .where('organizationId', router.matchers.uuid())
    })
    .prefix('/organizations')
    .where('id', router.matchers.uuid())
}
