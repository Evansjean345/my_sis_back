// start/routes.ts
import router from '@adonisjs/core/services/router'
import transmit from '@adonisjs/transmit/services/main'
import { authRoutes } from '#start/routes/auth'
import { clientRoutes } from '#start/routes/client_routes'
import { adminRoutes } from '#start/routes/admin_routes'

/**
 * Routage de l'API — versionné dès le premier jour.
 * (TDR : intégrations ERP, logistiques et SIEM.)
 */

// Matchers globaux : un :id mal formé → 404, pas un 22P02 PostgreSQL.
router.where('id', router.matchers.uuid())
router.where('memberId', router.matchers.uuid())
router.where('organizationId', router.matchers.uuid())
router.where('commandId', router.matchers.uuid())

transmit.registerRoutes() // UNIQUEMENT ici

router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok', service: 'sisbm-core', time: new Date().toISOString() })
})

router
  .group(() => {
    authRoutes() // login public ; me/logout protégés dans le fichier
    clientRoutes() // auth()
    adminRoutes() // auth() + platformAdmin()
  })
  .prefix('/api/v1')
