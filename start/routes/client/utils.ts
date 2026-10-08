import router from '@adonisjs/core/services/router'
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')

// ---- organisation de l'acteur et indicateurs du tableau de bord client
export const getUtilsRoutes = () => {
  router
    .group(() => {
      router.get('/commands/stats', [CommandController, 'stats'])
      router.get('/commands', [CommandController, 'index'])
      router.get('/stats/activity', [OrganizationController, 'dailyActivity'])
      router.get('/overview', [OrganizationController, 'overview'])
    })
    .where('id', router.matchers.uuid())
}
