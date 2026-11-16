import router from '@adonisjs/core/services/router'
const VehicleController = () => import('#presentation/http/controllers/fleet/vehicle_controller')

// ---- carte temps réel : toute la flotte de l'organisation en un appel
export const fleetRoutes = () => {
  router.get('/fleet/live', [VehicleController, 'live']).where('id', router.matchers.uuid())
}
