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
    })
    .prefix('/drivers')
    .where('id', router.matchers.uuid())

  router
    .get('/vehicles/:id/drivers', [DriverController, 'vehicleDrivers'])
    .where('id', router.matchers.uuid())
}
