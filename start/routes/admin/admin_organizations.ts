import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')
const AuditLogController = () => import('#presentation/http/controllers/audit/audit_log_controller')

export const adminOrgRoutes = () => {
  router
    .group(() => {
      // ---- organisations
      // `/stats` AVANT `/:id` : l'ordre reste explicite même si le matcher uuid
      // empêche déjà la collision.
      router.get('/stats', [OrganizationController, 'statsAll'])
      router.get('/', [OrganizationController, 'index'])
      router.post('/', [OrganizationController, 'store'])
      router.get('/:id', [OrganizationController, 'show'])
      router.patch('/:id', [OrganizationController, 'update'])
      router.get('/:id/users', [OrganizationController, 'users'])
      router.post('/:id/users', [OrganizationController, 'storeUser'])
      router.get('/:id/roles', [OrganizationController, 'roles'])
      router.get('/:id/audit-logs', [AuditLogController, 'byOrganization'])
    })
    .prefix('/organizations')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
