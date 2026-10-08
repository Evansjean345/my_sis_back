import router from '@adonisjs/core/services/router'
import { throttle } from '#start/limiter'
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')

/**
 * Commandes métier acceptées par `POST /admin/devices/:id/commands/:command`.
 * La coupure et le rétablissement moteur n'y figurent PAS : ils passent par
 * `/security/*` (garde-fou de vitesse CM-07, double validation).
 */
//à mettre dans un fichier
const COMMANDES_METIER =
  /^(arm|disarm|request-status|reboot|start-tracking|stop-tracking|set-output|set-admin-number|change-password|reset-password|set-apn|add-geofence|remove-geofence)$/

export const adminDeviceCommandsGroup = () => {
  /**
   * Agissent sur du MATÉRIEL RÉEL : même limiteur que les routes client,
   * distinct de celui de `/security/*` (cf. start/limiter.ts).
   * Règle du tableau de bord : chaque commande envoyée est suivie d'un
   * `POST /admin/devices/:id/commands/sync`.
   */
  router
    .group(() => {
      router.post('/:id/commands/sync', [CommandController, 'syncAll'])
      router.post('/:id/commands/send', [CommandController, 'sendAll'])
      router
        .delete('/:id/commands/:commandId', [CommandController, 'cancelAll'])
        .where('commandId', router.matchers.uuid())
      router
        .post('/:id/commands/:command', [CommandController, 'executeAll'])
        .where('command', COMMANDES_METIER)

      // Coupure / rétablissement moteur : refus explicite plutôt qu'un 404.
      //à supprimer
      router
        .post('/:id/commands/cut-engine', [CommandController, 'engineForbidden'])
        .as('commands.cutEngineForbidden')
      router
        .post('/:id/commands/restore-engine', [CommandController, 'engineForbidden'])
        .as('commands.restoreEngineForbidden')
    })
    .prefix('/devices')
    .where('id', router.matchers.uuid())
    .use(throttle.deviceCommands)
}
