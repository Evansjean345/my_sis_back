import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.me': { paramsTuple?: []; params?: {} }
    'auth.logout': { paramsTuple?: []; params?: {} }
    'audit_log.index': { paramsTuple?: []; params?: {} }
    'audit_log.actions': { paramsTuple?: []; params?: {} }
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.sync': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'command.arm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.disarm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.request_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reboot': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.start_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stop_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_output': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.send.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set-admin-number.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.change-password.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reset-password.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set-apn.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.add-geofence.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.remove-geofence.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.index': { paramsTuple?: []; params?: {} }
    'device_group.store': { paramsTuple?: []; params?: {} }
    'device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.index': { paramsTuple?: []; params?: {} }
    'vehicle_group.store': { paramsTuple?: []; params?: {} }
    'vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.stats': { paramsTuple?: []; params?: {} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'devices.storeForbidden': { paramsTuple?: []; params?: {} }
    'devices.destroyForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'devices.syncFlespiForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'devices.flespiCatalogForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.live': { paramsTuple?: []; params?: {} }
    'organization.current': { paramsTuple?: []; params?: {} }
    'organization.index': { paramsTuple?: []; params?: {} }
    'organization.store': { paramsTuple?: []; params?: {} }
    'organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.vehicleGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.change_password': { paramsTuple?: []; params?: {} }
    'user.stats': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.store': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.activate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.stats': { paramsTuple?: []; params?: {} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.store': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stats': { paramsTuple?: []; params?: {} }
    'command.index': { paramsTuple?: []; params?: {} }
    'organization.daily_activity': { paramsTuple?: []; params?: {} }
    'organization.overview': { paramsTuple?: []; params?: {} }
    'immobilization.store': { paramsTuple?: []; params?: {} }
    'immobilization.dispatch': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.restore': { paramsTuple?: []; params?: {} }
    'immobilization.store_for_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.restore_for_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.index': { paramsTuple?: []; params?: {} }
    'usage_schedule.store': { paramsTuple?: []; params?: {} }
    'usage_schedule.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.replace_windows': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.attach_vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.detach_vehicle': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'usage_schedule.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'usage_schedule.vehicle_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.group_schedules': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.index': { paramsTuple?: []; params?: {} }
    'driver.store': { paramsTuple?: []; params?: {} }
    'driver.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.assign_vehicle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'groupId': ParamValue} }
    'driver.vehicle_drivers': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.index': { paramsTuple?: []; params?: {} }
    'driver_group.store': { paramsTuple?: []; params?: {} }
    'driver_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'driver_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.sync_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.send_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.cancel_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'admin.command.execute_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'command': ParamValue} }
    'admin.commands.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.commands.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.stats_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.store_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.stats_all': { paramsTuple?: []; params?: {} }
    'admin.device.index_all': { paramsTuple?: []; params?: {} }
    'admin.device.store_all': { paramsTuple?: []; params?: {} }
    'admin.device.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.assign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.unassign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.sync_flespi_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_status_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_logs_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.flespi_catalog_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.results_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.stats_all': { paramsTuple?: []; params?: {} }
    'admin.organization.index': { paramsTuple?: []; params?: {} }
    'admin.organization.store': { paramsTuple?: []; params?: {} }
    'admin.organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.stats_all': { paramsTuple?: []; params?: {} }
    'admin.user.index_all': { paramsTuple?: []; params?: {} }
    'admin.user.store_all': { paramsTuple?: []; params?: {} }
    'admin.user.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.suspend_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.activate_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.overview_all': { paramsTuple?: []; params?: {} }
    'admin.organization.activity_all': { paramsTuple?: []; params?: {} }
    'admin.command.stats_all': { paramsTuple?: []; params?: {} }
    'admin.command.index_all': { paramsTuple?: []; params?: {} }
    'admin.audit_log.index': { paramsTuple?: []; params?: {} }
    'admin.audit_log.actions': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.index_all': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.store_all': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.replace_windows': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.attach_vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.detach_vehicle': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.usage_schedule.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.driver.index_all': { paramsTuple?: []; params?: {} }
    'admin.driver.store_all': { paramsTuple?: []; params?: {} }
    'admin.driver.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.assign_vehicle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.assign_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.remove_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'groupId': ParamValue} }
    'admin.driver_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.driver_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.driver_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.driver_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.health': { paramsTuple?: []; params?: {} }
    'flespi_channel.protocols': { paramsTuple?: []; params?: {} }
    'flespi_channel.device_types': { paramsTuple: [ParamValue]; params: {'protocol': ParamValue} }
    'flespi_channel.device_type': { paramsTuple: [ParamValue,ParamValue]; params: {'protocol': ParamValue,'typeId': ParamValue} }
    'flespi_channel.index': { paramsTuple?: []; params?: {} }
    'flespi_channel.store': { paramsTuple?: []; params?: {} }
    'flespi_channel.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.messages': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.connections': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.idents': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'auth.me': { paramsTuple?: []; params?: {} }
    'audit_log.index': { paramsTuple?: []; params?: {} }
    'audit_log.actions': { paramsTuple?: []; params?: {} }
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.index': { paramsTuple?: []; params?: {} }
    'device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.index': { paramsTuple?: []; params?: {} }
    'vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.stats': { paramsTuple?: []; params?: {} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'devices.flespiCatalogForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.live': { paramsTuple?: []; params?: {} }
    'organization.current': { paramsTuple?: []; params?: {} }
    'organization.index': { paramsTuple?: []; params?: {} }
    'organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.stats': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.stats': { paramsTuple?: []; params?: {} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stats': { paramsTuple?: []; params?: {} }
    'command.index': { paramsTuple?: []; params?: {} }
    'organization.daily_activity': { paramsTuple?: []; params?: {} }
    'organization.overview': { paramsTuple?: []; params?: {} }
    'usage_schedule.index': { paramsTuple?: []; params?: {} }
    'usage_schedule.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.vehicle_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.group_schedules': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.index': { paramsTuple?: []; params?: {} }
    'driver.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.vehicle_drivers': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.index': { paramsTuple?: []; params?: {} }
    'driver_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.stats_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.stats_all': { paramsTuple?: []; params?: {} }
    'admin.device.index_all': { paramsTuple?: []; params?: {} }
    'admin.device.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_status_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_logs_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.flespi_catalog_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.results_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.stats_all': { paramsTuple?: []; params?: {} }
    'admin.organization.index': { paramsTuple?: []; params?: {} }
    'admin.organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.stats_all': { paramsTuple?: []; params?: {} }
    'admin.user.index_all': { paramsTuple?: []; params?: {} }
    'admin.user.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.overview_all': { paramsTuple?: []; params?: {} }
    'admin.organization.activity_all': { paramsTuple?: []; params?: {} }
    'admin.command.stats_all': { paramsTuple?: []; params?: {} }
    'admin.command.index_all': { paramsTuple?: []; params?: {} }
    'admin.audit_log.index': { paramsTuple?: []; params?: {} }
    'admin.audit_log.actions': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.index_all': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.index_all': { paramsTuple?: []; params?: {} }
    'admin.driver.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.driver_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.health': { paramsTuple?: []; params?: {} }
    'flespi_channel.protocols': { paramsTuple?: []; params?: {} }
    'flespi_channel.device_types': { paramsTuple: [ParamValue]; params: {'protocol': ParamValue} }
    'flespi_channel.device_type': { paramsTuple: [ParamValue,ParamValue]; params: {'protocol': ParamValue,'typeId': ParamValue} }
    'flespi_channel.index': { paramsTuple?: []; params?: {} }
    'flespi_channel.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.messages': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.connections': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.idents': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'auth.me': { paramsTuple?: []; params?: {} }
    'audit_log.index': { paramsTuple?: []; params?: {} }
    'audit_log.actions': { paramsTuple?: []; params?: {} }
    'command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.index': { paramsTuple?: []; params?: {} }
    'device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.index': { paramsTuple?: []; params?: {} }
    'vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.stats': { paramsTuple?: []; params?: {} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.live_history': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.flespi_telemetry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'devices.flespiCatalogForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.live': { paramsTuple?: []; params?: {} }
    'organization.current': { paramsTuple?: []; params?: {} }
    'organization.index': { paramsTuple?: []; params?: {} }
    'organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.index': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'user.roles': { paramsTuple?: []; params?: {} }
    'user.stats': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.stats': { paramsTuple?: []; params?: {} }
    'vehicle.index': { paramsTuple?: []; params?: {} }
    'vehicle.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stats': { paramsTuple?: []; params?: {} }
    'command.index': { paramsTuple?: []; params?: {} }
    'organization.daily_activity': { paramsTuple?: []; params?: {} }
    'organization.overview': { paramsTuple?: []; params?: {} }
    'usage_schedule.index': { paramsTuple?: []; params?: {} }
    'usage_schedule.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.vehicle_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.group_schedules': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.index': { paramsTuple?: []; params?: {} }
    'driver.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.vehicle_drivers': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.index': { paramsTuple?: []; params?: {} }
    'driver_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.stats_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.index_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.stats_all': { paramsTuple?: []; params?: {} }
    'admin.device.index_all': { paramsTuple?: []; params?: {} }
    'admin.device.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.live_history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_status_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_logs_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.flespi_telemetry_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.flespi_catalog_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.catalog': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.history_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.results_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.stats_all': { paramsTuple?: []; params?: {} }
    'admin.organization.index': { paramsTuple?: []; params?: {} }
    'admin.organization.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.users': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.roles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_log.by_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.stats_all': { paramsTuple?: []; params?: {} }
    'admin.user.index_all': { paramsTuple?: []; params?: {} }
    'admin.user.show_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.overview_all': { paramsTuple?: []; params?: {} }
    'admin.organization.activity_all': { paramsTuple?: []; params?: {} }
    'admin.command.stats_all': { paramsTuple?: []; params?: {} }
    'admin.command.index_all': { paramsTuple?: []; params?: {} }
    'admin.audit_log.index': { paramsTuple?: []; params?: {} }
    'admin.audit_log.actions': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.index_all': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.index_all': { paramsTuple?: []; params?: {} }
    'admin.driver.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.index_all': { paramsTuple?: []; params?: {} }
    'admin.driver_group.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.members': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.audit_logs_of_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.health': { paramsTuple?: []; params?: {} }
    'flespi_channel.protocols': { paramsTuple?: []; params?: {} }
    'flespi_channel.device_types': { paramsTuple: [ParamValue]; params: {'protocol': ParamValue} }
    'flespi_channel.device_type': { paramsTuple: [ParamValue,ParamValue]; params: {'protocol': ParamValue,'typeId': ParamValue} }
    'flespi_channel.index': { paramsTuple?: []; params?: {} }
    'flespi_channel.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.messages': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.connections': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.idents': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.logout': { paramsTuple?: []; params?: {} }
    'command.sync': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.arm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.disarm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.request_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reboot': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.start_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.stop_tracking': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set_output': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.send.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set-admin-number.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.change-password.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.reset-password.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.set-apn.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.add-geofence.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.remove-geofence.forbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'command.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.store': { paramsTuple?: []; params?: {} }
    'device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.store': { paramsTuple?: []; params?: {} }
    'vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'devices.storeForbidden': { paramsTuple?: []; params?: {} }
    'devices.syncFlespiForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.store': { paramsTuple?: []; params?: {} }
    'organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organizations.vehicleGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'organizations.deviceGroups.store': { paramsTuple: [ParamValue]; params: {'organizationId': ParamValue} }
    'user.change_password': { paramsTuple?: []; params?: {} }
    'user.store': { paramsTuple?: []; params?: {} }
    'user.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.activate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.store': { paramsTuple?: []; params?: {} }
    'immobilization.store': { paramsTuple?: []; params?: {} }
    'immobilization.dispatch': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.restore': { paramsTuple?: []; params?: {} }
    'immobilization.store_for_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'immobilization.restore_for_group': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.store': { paramsTuple?: []; params?: {} }
    'usage_schedule.attach_vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.store': { paramsTuple?: []; params?: {} }
    'driver.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.store': { paramsTuple?: []; params?: {} }
    'driver_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.device_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.sync_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.send_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.command.execute_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'command': ParamValue} }
    'admin.commands.cutEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.commands.restoreEngineForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.vehicle_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.store_all': { paramsTuple?: []; params?: {} }
    'admin.device.store_all': { paramsTuple?: []; params?: {} }
    'admin.device.assign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.sync_flespi_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.store': { paramsTuple?: []; params?: {} }
    'admin.organization.store_user': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.store_all': { paramsTuple?: []; params?: {} }
    'admin.user.suspend_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.activate_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.store_all': { paramsTuple?: []; params?: {} }
    'admin.usage_schedule.attach_vehicles': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.store_all': { paramsTuple?: []; params?: {} }
    'admin.driver.attach_groups': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.store_all': { paramsTuple?: []; params?: {} }
    'admin.driver_group.assign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.store': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
    'command.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'devices.destroyForbidden': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.unassign': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.detach_vehicle': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'usage_schedule.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'driver.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'groupId': ParamValue} }
    'driver_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.device_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.command.cancel_all': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commandId': ParamValue} }
    'admin.vehicle_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.vehicle.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.unassign_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.destroy_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.detach_vehicle': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.usage_schedule.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'admin.driver.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.remove_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.detach_group': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'groupId': ParamValue} }
    'admin.driver_group.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.unassign': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'memberId': ParamValue} }
    'flespi_channel.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PATCH: {
    'device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'user.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vehicle.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'usage_schedule.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.vehicle.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.device.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organization.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.user.update_all': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver_group.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'flespi_channel.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'usage_schedule.replace_windows': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'driver.assign_vehicle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.usage_schedule.replace_windows': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.assign_vehicle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.driver.assign_organization': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}