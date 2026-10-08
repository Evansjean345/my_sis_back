import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const VehicleController = () => import('#presentation/http/controllers/fleet/vehicle_controller')

export const adminVehicleRoutes = () => {
  router
    .group(() => {
      router.get('/stats', [VehicleController, 'statsAll'])
      router.get('/', [VehicleController, 'indexAll'])
      router.post('/', [VehicleController, 'storeAll'])
      router.get('/:id', [VehicleController, 'showAll'])
      router.patch('/:id', [VehicleController, 'updateAll'])
      router.delete('/:id', [VehicleController, 'destroyAll'])
    })
    .prefix('/vehicles')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
