import router from '@adonisjs/core/services/router'
const TripReportController = () =>
  import('#presentation/http/controllers/telemetry/trip_report_controller')

/** Rapports d'activité (espace client du SuperAdmin). */
export const adminReportRoutes = () => {
  router
    .group(() => {
      router.get('/trips', [TripReportController, 'tripsAll'])
    })
    .prefix('/reports')
}
