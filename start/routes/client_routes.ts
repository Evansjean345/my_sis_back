// start/routes/client_routes.ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { auditLogsRoutes } from '#start/routes/client/audit'
import { deviceCommandsRoutes } from '#start/routes/client/device_commands'
import { deviceGroupRoutes } from '#start/routes/client/device_group'
import { deviceRoutes } from '#start/routes/client/devices'
import { fleetRoutes } from '#start/routes/client/fleet'
import { organizationRoutes } from '#start/routes/client/organizations'
import { userRoles, userRoutes } from '#start/routes/client/users'
import { vehicleRoutes } from '#start/routes/client/vehicles'
import { vehicleGroupRoutes } from '#start/routes/client/vehicle_group'
import { getUtilsRoutes } from '#start/routes/client/utils'
import { SecurityAndImmobilizationRoutes } from '#start/routes/client/security_immobilizations'

export const clientRoutes = () => {
  router
    .group(() => {
      auditLogsRoutes()
      deviceCommandsRoutes()
      deviceGroupRoutes()
      vehicleGroupRoutes()
      deviceRoutes()
      fleetRoutes()
      organizationRoutes()
      userRoles()
      userRoutes()
      vehicleRoutes()
      getUtilsRoutes()
      SecurityAndImmobilizationRoutes()
    })
    .use(middleware.auth())
}
