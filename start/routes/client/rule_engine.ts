import router from '@adonisjs/core/services/router'
const GeofenceController = () => import('#presentation/http/controllers/policy/geofence_controller')
const SpeedPolicyController = () =>
  import('#presentation/http/controllers/policy/speed_policy_controller')
const RuleController = () => import('#presentation/http/controllers/policy/rule_controller')

/**
 * Moteur de règles de MON organisation (migration 032) : zones, politiques de
 * vitesse, règles. Lecture : `geofence:read` / `policy:read` ; écriture :
 * `geofence:write` / `policy:write` (admin). Pas de suppression : `/toggle`.
 */
export const ruleEngineRoutes = () => {
  router
    .group(() => {
      router.get('/', [GeofenceController, 'index'])
      router.post('/', [GeofenceController, 'store'])
      router.patch('/:id', [GeofenceController, 'update'])
      router.post('/:id/toggle', [GeofenceController, 'toggle'])
    })
    .prefix('/geofences')
    .where('id', router.matchers.uuid())

  router
    .group(() => {
      router.get('/', [SpeedPolicyController, 'index'])
      router.post('/', [SpeedPolicyController, 'store'])
      router.patch('/:id', [SpeedPolicyController, 'update'])
      router.post('/:id/toggle', [SpeedPolicyController, 'toggle'])
    })
    .prefix('/speed-policies')
    .where('id', router.matchers.uuid())

  router
    .group(() => {
      router.get('/', [RuleController, 'index'])
      router.post('/', [RuleController, 'store'])
      router.patch('/:id', [RuleController, 'update'])
      router.post('/:id/toggle', [RuleController, 'toggle'])
    })
    .prefix('/rules')
    .where('id', router.matchers.uuid())
}
