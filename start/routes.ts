// start/routes.ts
import router from '@adonisjs/core/services/router'
import { authRoutes } from '#start/routes/auth'
import { clientRoutes } from '#start/routes/client_routes'
import { adminRoutes } from '#start/routes/admin_routes'
import { flespiGatewaysRoutes } from '#start/routes/admin/admin_flespi_gateways'
import { webhookRoutes } from '#start/routes/webhooks'

/**
 * Routage de l'API — versionné dès le premier jour.
 * (TDR : intégrations ERP, logistiques et SIEM.)
 */

// Matchers globaux : un :id mal formé → 404, pas un 22P02 PostgreSQL.
router.where('id', router.matchers.uuid())
router.where('memberId', router.matchers.uuid())
router.where('organizationId', router.matchers.uuid())
router.where('commandId', router.matchers.uuid())

/**
 * Le temps réel (SSE) est enregistré dans `start/transmit.ts`, avec le
 * cloisonnement de ses canaux : les deux vont ensemble, et les séparer est
 * précisément ce qui a laissé les canaux ouverts.
 */

router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok', service: 'sisbm-core', time: new Date().toISOString() })
})

router
  .group(() => {
    authRoutes() // login public ; me/logout protégés dans le fichier
    clientRoutes() // auth()
    adminRoutes() // auth() + platformAdmin()
    /**
     * Passerelles flespi : URL historique `/api/v1/flespi/*` (consommée par le
     * tableau de bord d'administration), mais périmètre PLATEFORME. Déclarées
     * ici, et non dans `clientRoutes()`, pour que le fichier ne laisse aucun
     * doute sur qui y a accès.
     */
    flespiGatewaysRoutes() // auth() + platformAdmin()
    webhookRoutes() // public, signature du prestataire (Twilio)
  })
  .prefix('/api/v1')
