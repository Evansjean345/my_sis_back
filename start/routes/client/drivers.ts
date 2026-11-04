import router from '@adonisjs/core/services/router'
const DriverController = () => import('#presentation/http/controllers/fleet/driver_controller')

// ---- conducteurs (migration 018)
export const driverRoutes = () => {
  router
    .group(() => {
      router.get('/', [DriverController, 'index'])
      router.post('/', [DriverController, 'store'])
      router.get('/:id', [DriverController, 'show'])
      router.patch('/:id', [DriverController, 'update'])
      router.delete('/:id', [DriverController, 'destroy'])
      router.put('/:id/vehicle', [DriverController, 'assignVehicle'])
      // groupes du conducteur (vue depuis la fiche conducteur)
      router.get('/:id/groups', [DriverController, 'groups'])
      router.post('/:id/groups', [DriverController, 'attachGroups'])
      router.delete('/:id/groups/:groupId', [DriverController, 'detachGroup'])
    })
    .prefix('/drivers')
    .where('id', router.matchers.uuid())
    .where('groupId', router.matchers.uuid())

  router
    .get('/vehicles/:id/drivers', [DriverController, 'vehicleDrivers'])
    .where('id', router.matchers.uuid())
}
