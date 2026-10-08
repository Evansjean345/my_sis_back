import router from '@adonisjs/core/services/router'
import { throttle } from '#start/limiter'
import type { HttpContext } from '@adonisjs/core/http'
import { reservedToPlatform } from '#presentation/http/support/tenant_resources'
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')

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

export const deviceCommandsRoutes = () => {
  router
    .group(() => {
      router.get('/:id/commands', [CommandController, 'catalog'])
      router.get('/:id/commands/history', [CommandController, 'history'])
      router.get('/:id/commands/results', [CommandController, 'results'])
      router.post('/:id/commands/sync', [CommandController, 'sync'])
      router
        .delete('/:id/commands/:commandId', [CommandController, 'cancel'])
        .where('commandId', router.matchers.uuid())

      // ---- alarme embarquée
      router.post('/:id/commands/arm', [CommandController, 'arm'])
      router.post('/:id/commands/disarm', [CommandController, 'disarm'])

      // ---- diagnostic
      router.post('/:id/commands/request-status', [CommandController, 'requestStatus'])
      router.post('/:id/commands/reboot', [CommandController, 'reboot'])

      // ---- rythme de reporting
      router.post('/:id/commands/start-tracking', [CommandController, 'startTracking'])
      router.post('/:id/commands/stop-tracking', [CommandController, 'stopTracking'])

      // ---- sortie auxiliaire
      router.post('/:id/commands/set-output', [CommandController, 'setOutput'])

      // ---- réservé à l'exploitant : configuration et commande brute
      //à definir dans un fichier
      const reservees = {
        'send': 'Commande flespi brute',
        'set-admin-number': 'Numéro administrateur du boîtier',
        'change-password': 'Mot de passe du boîtier',
        'reset-password': 'Réinitialisation du mot de passe du boîtier',
        'set-apn': 'Configuration APN',
        'add-geofence': 'Géofence embarquée',
        'remove-geofence': 'Géofence embarquée',
      } as const
      for (const [slug, operation] of Object.entries(reservees)) {
        router
          .post(`/:id/commands/${slug}`, platformOnly(operation))
          .as(`command.${slug}.forbidden`)
      }

      /**
       * Coupure moteur : REFUSÉE ici, volontairement.
       * Elle passe par /security/immobilizations, qui applique le garde-fou de
       * vitesse (CM-07), la fraîcheur de position et la traçabilité complète.
       * Ces deux routes existent pour renvoyer un message explicite plutôt qu'un
       * 404 qui laisserait croire à une erreur de chemin.
       */
      //à supprimer
      router
        .post('/:id/commands/cut-engine', [CommandController, 'engineForbidden'])
        .as('command.cutEngineForbidden')
      router
        .post('/:id/commands/restore-engine', [CommandController, 'engineForbidden'])
        .as('command.restoreEngineForbidden')
    })
    .prefix('/devices')
    .where('id', router.matchers.uuid())
    .use(throttle.sensitive)
}
