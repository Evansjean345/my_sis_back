// start/routes/admin_routes.ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { adminDeviceCommandsGroup } from '#start/routes/admin/admin_device_command'
import { adminDeviceRoutes } from '#start/routes/admin/admin_device'
import { adminOrgRoutes } from '#start/routes/admin/admin_organizations'
import { adminUsersRoutes } from '#start/routes/admin/admin_users'
import { adminUtilRoutes } from '#start/routes/admin/admin_utils'
import { adminVehicleGroupRoutes } from '#start/routes/admin/admin_vehicle_group'
import { adminDeviceGroupRoutes } from '#start/routes/admin/admin_device_group'
import { adminVehicleRoutes } from '#start/routes/admin/admin_vehicle'
import { adminUsageScheduleRoutes } from '#start/routes/admin/admin_usage_schedules'
import { adminDriverRoutes } from '#start/routes/admin/admin_drivers'
import { adminSmsRoutes } from '#start/routes/admin/admin_sms'

export const adminRoutes = () => {
  router
    .group(() => {
      adminDeviceGroupRoutes()
      adminDeviceCommandsGroup()
      adminVehicleGroupRoutes()
      adminVehicleRoutes()
      adminDeviceRoutes()
      adminOrgRoutes()
      adminUsersRoutes()
      adminUtilRoutes()
      adminUsageScheduleRoutes()
      adminDriverRoutes()
      adminSmsRoutes()
    })
    .prefix('/admin')
    .as('admin')
    .use([middleware.auth(), middleware.platformAdmin()])
}
