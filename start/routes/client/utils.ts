import router from '@adonisjs/core/services/router'
const CommandController = () =>
  import('#presentation/http/controllers/fleet/device_command_controller')
const OrganizationController = () =>
  import('#presentation/http/controllers/identity/organization_controller')

// ---- organisation de l'acteur et indicateurs du tableau de bord client
export const getUtilsRoutes = () => {
  router
    .group(() => {
      router.get('/commands/stats', [CommandController, 'stats' as never])
      router.get('/commands', [CommandController, 'index' as never])
      router.get('/stats/activity', [OrganizationController, 'dailyActivity' as never])
      router.get('/overview', [OrganizationController, 'overview' as never])
    })
    .where('id', router.matchers.uuid())
}
