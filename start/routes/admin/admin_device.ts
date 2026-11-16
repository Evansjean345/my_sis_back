import router from '@adonisjs/core/services/router'

const DeviceController = () => import('#presentation/http/controllers/fleet/device_controller')
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')

export const adminDeviceRoutes = () => {
  router
    .group(() => {
      // ---- boîtiers
      router.get('/stats', [DeviceController, 'statsAll'])
      router.get('/', [DeviceController, 'indexAll'])
      router.post('/', [DeviceController, 'storeAll'])
      router.get('/:id', [DeviceController, 'showAll'])
      router.patch('/:id', [DeviceController, 'updateAll'])
      router.delete('/:id', [DeviceController, 'destroyAll'])
      router.post('/:id/assignment', [DeviceController, 'assignAll'])
      router.delete('/:id/assignment', [DeviceController, 'unassignAll'])

      // ---- boîtiers : diagnostic flespi
      router.get('/:id/telemetry', [DeviceController, 'liveTelemetryAll'])
      router.get('/:id/telemetry/history', [DeviceController, 'liveHistoryAll'])
      router.post('/:id/flespi/sync', [DeviceController, 'syncFlespiAll'])
      router.get('/:id/flespi', [DeviceController, 'flespiStatusAll'])
      router.get('/:id/flespi/logs', [DeviceController, 'flespiLogsAll'])
      router.get('/:id/flespi/telemetry', [DeviceController, 'flespiTelemetryAll'])
      router.get('/:id/flespi/commands', [CommandController, 'flespiCatalogAll'])

      // Catalogue métier statique (aucune lecture du boîtier) : fonction client réutilisée.
      router.get('/:id/commands', [CommandController, 'catalog'])
      router.get('/:id/commands/history', [CommandController, 'historyAll'])
      router.get('/:id/commands/results', [CommandController, 'resultsAll'])
    })
    .prefix('/devices')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
