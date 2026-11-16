import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
const FlespiChannelController = () =>
  import('#presentation/http/controllers/fleet/flespi_channel_controller')

/**
 * Passerelles flespi — PÉRIMÈTRE PLATEFORME.
 *
 * Le jeton flespi ne quitte jamais le serveur : ces routes relaient l'API
 * flespi (canaux, protocoles, journaux) et n'ont aucun sens pour un client.
 * L'URL reste `/api/v1/flespi/*` — elle est déjà consommée par le tableau de
 * bord d'administration — mais la déclaration porte ses deux middlewares,
 * sans dépendre du groupe qui l'appelle.
 */
export const flespiGatewaysRoutes = () => {
  router
    .group(() => {
      router.get('/health', [FlespiChannelController, 'health'])

      router.get('/protocols', [FlespiChannelController, 'protocols'])
      router.get('/protocols/:protocol/device-types', [FlespiChannelController, 'deviceTypes'])
      router.get('/protocols/:protocol/device-types/:typeId', [
        FlespiChannelController,
        'deviceType',
      ])

      router.get('/channels', [FlespiChannelController, 'index'])
      router.post('/channels', [FlespiChannelController, 'store'])
      router.get('/channels/:id', [FlespiChannelController, 'show']).where('id', /^\d+$/)
      router.patch('/channels/:id', [FlespiChannelController, 'update']).where('id', /^\d+$/)
      router.delete('/channels/:id', [FlespiChannelController, 'destroy']).where('id', /^\d+$/)
      router.get('/channels/:id/logs', [FlespiChannelController, 'logs']).where('id', /^\d+$/)
      router
        .get('/channels/:id/messages', [FlespiChannelController, 'messages'])
        .where('id', /^\d+$/)
      router
        .get('/channels/:id/connections', [FlespiChannelController, 'connections'])
        .where('id', /^\d+$/)
      router.get('/channels/:id/idents', [FlespiChannelController, 'idents']).where('id', /^\d+$/)
    })
    .prefix('/flespi')
    .use([middleware.auth(), middleware.platformAdmin()])
}
