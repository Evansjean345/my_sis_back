import router from '@adonisjs/core/services/router'
const GeofenceController = () => import('#presentation/http/controllers/policy/geofence_controller')
const SpeedPolicyController = () =>
  import('#presentation/http/controllers/policy/speed_policy_controller')
const RuleController = () => import('#presentation/http/controllers/policy/rule_controller')

/**
 * Moteur de règles de TOUS les clients (plateforme) : `?organizationId=` filtre
 * les listes ; `organizationId` est obligatoire à la création.
 */
export const adminRuleEngineRoutes = () => {
  router
    .group(() => {
      router.get('/', [GeofenceController, 'indexAll'])
      router.post('/', [GeofenceController, 'storeAll'])
      router.patch('/:id', [GeofenceController, 'updateAll'])
      router.post('/:id/toggle', [GeofenceController, 'toggleAll'])
    })
    .prefix('/geofences')
    .where('id', router.matchers.uuid())

  router
    .group(() => {
      router.get('/', [SpeedPolicyController, 'indexAll'])
      router.post('/', [SpeedPolicyController, 'storeAll'])
      router.patch('/:id', [SpeedPolicyController, 'updateAll'])
      router.post('/:id/toggle', [SpeedPolicyController, 'toggleAll'])
    })
    .prefix('/speed-policies')
    .where('id', router.matchers.uuid())

  router
    .group(() => {
      router.get('/', [RuleController, 'indexAll'])
      router.post('/', [RuleController, 'storeAll'])
      router.patch('/:id', [RuleController, 'updateAll'])
      router.post('/:id/toggle', [RuleController, 'toggleAll'])
    })
    .prefix('/rules')
    .where('id', router.matchers.uuid())
}
