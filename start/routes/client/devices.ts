import router from '@adonisjs/core/services/router'
import type { HttpContext } from '@adonisjs/core/http'
import { reservedToPlatform } from '#presentation/http/support/tenant_resources'
const DeviceController = () => import('#presentation/http/controllers/fleet/device_controller')

// --------------------------------------------------------------- API authentifiée
/**
 * PÉRIMÈTRE CLIENT : toutes les routes de ce fichier (hors `/organizations`,
 * `/flespi` et `/admin`) lisent et écrivent dans l'organisation de l'acteur,
 * et UNIQUEMENT elle. Aucune ne prend d'`organizationId` en paramètre : il
 * vient du jeton. Une ressource d'un autre client est introuvable (404).
 *
 * Les opérations d'exploitation (création / suppression / rattachement
 * flespi des trackers, commandes de configuration) répondent 403
 * `E_PLATFORM_ONLY` et désignent leur équivalent `/api/v1/admin/*`.
 */
const platformOnly = (operation: string) => (ctx: HttpContext) => reservedToPlatform(ctx, operation)

export const deviceRoutes = () => {
  router
    .group(() => {
      router.get('/stats', [DeviceController, 'stats'])
      router.get('/', [DeviceController, 'index'])
      router.get('/:id', [DeviceController, 'show'])
      router.patch('/:id', [DeviceController, 'update'])
      router.post('/', platformOnly('Création de tracker')).as('devices.storeForbidden')
      router.delete('/:id', platformOnly('Suppression de tracker')).as('devices.destroyForbidden')
      router
        .post('/:id/flespi/sync', platformOnly('Rattachement flespi'))
        .as('devices.syncFlespiForbidden')

      // ---- affectation datée boîtier <-> véhicule
      router.post('/:id/assignment', [DeviceController, 'assign'])
      router.delete('/:id/assignment', [DeviceController, 'unassign'])

      // ---- diagnostic : interroge FLESPI, pas notre base
      router.get('/:id/telemetry', [DeviceController, 'liveTelemetry'])
      router.get('/:id/telemetry/history', [DeviceController, 'liveHistory'])

      // ---- état flespi du boîtier (lecture seule)
      router.get('/:id/flespi', [DeviceController, 'flespiStatus'])
      router.get('/:id/flespi/logs', [DeviceController, 'flespiLogs'])
      router.get('/:id/flespi/telemetry', [DeviceController, 'flespiTelemetry'])
      // Catalogue flespi BRUT : ne sert qu'à la commande brute, réservée à l'exploitant.
      router
        .get('/:id/flespi/commands', platformOnly('Catalogue de commandes flespi'))
        .as('devices.flespiCatalogForbidden')
    })
    .prefix('/devices')
    .where('id', router.matchers.uuid())
}
