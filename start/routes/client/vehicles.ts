import router from '@adonisjs/core/services/router'
const VehicleController = () => import('#presentation/http/controllers/fleet/vehicle_controller')

export const vehicleRoutes = () => {
  router
    .group(() => {
      router.get('/stats', [VehicleController, 'stats'])
      router.get('/', [VehicleController, 'index'])
      router.post('/', [VehicleController, 'store'])
      router.get('/:id', [VehicleController, 'show'])
      router.patch('/:id', [VehicleController, 'update'])
      router.delete('/:id', [VehicleController, 'destroy'])
    })
    .prefix('/vehicles')
    .where('id', router.matchers.uuid())
}
