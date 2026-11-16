import router from '@adonisjs/core/services/router'
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')
const AuditLogController = () => import('#presentation/http/controllers/audit/audit_log_controller')

export const adminUtilRoutes = () => {
  router
    .group(() => {
      router.get('/overview', [OrganizationController, 'overviewAll'])
      router.get('/stats/activity', [OrganizationController, 'activityAll'])
      // ---- commandes : lecture
      router.get('/commands/stats', [CommandController, 'statsAll'])
      router.get('/commands', [CommandController, 'indexAll'])

      // ---- journal d'audit (toutes organisations, ou ?organizationId=)
      router.get('/audit-logs', [AuditLogController, 'index'])
      router.get('/audit-logs/actions', [AuditLogController, 'actions'])
    })
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
