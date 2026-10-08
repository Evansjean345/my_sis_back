import router from '@adonisjs/core/services/router'
const AuditLogController = () => import('#presentation/http/controllers/audit/audit_log_controller')

export const auditLogsRoutes = () => {
  router
    .group(() => {
      router.get('/', [AuditLogController, 'index'])
      router.get('/actions', [AuditLogController, 'actions'])
    })
    .prefix('/audit-logs')
    .where('id', router.matchers.uuid())
}
