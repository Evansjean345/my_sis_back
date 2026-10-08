import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const VehicleGroupController = () =>
  import('#presentation/http/controllers/fleet/vehicle_group_controller')

export const adminVehicleGroupRoutes = () => {
  router
    .group(() => {
      // ---- groupes de véhicules
      // Liste et création : fonctions `*All`. Le reste réutilise les fonctions
      // client, dont la recherche du groupe est déjà ouverte au joker `*`.
      router.get('/', [VehicleGroupController, 'indexAll'])
      router.post('/', [VehicleGroupController, 'storeAll'])
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
