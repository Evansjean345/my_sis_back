import { inject } from '@adonisjs/core'
import DriverGroupModel from '#infrastructure/persistence/models/driver_group_model'
import { LucidDriverGroupMembership } from '#infrastructure/persistence/repositories/group_membership_repository'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { LucidAuditLogReader } from '#infrastructure/persistence/readers/audit_log_reader'
import { GroupControllerBase } from '#presentation/http/controllers/fleet/group_controller_base'

/**
 * Groupes de conducteurs (migration 018).
 *
 * Troisième famille du socle commun des groupes : mêmes routes, même
 * cloisonnement, même journal que les groupes de véhicules et de boîtiers.
 * Habilitations `vehicle:read` / `vehicle:write`, comme les conducteurs.
 */
@inject()
export default class DriverGroupController extends GroupControllerBase {
  constructor(
    membership: LucidDriverGroupMembership,
    audit: LucidAuditLogger,
    auditLogs: LucidAuditLogReader
  ) {
    super(
      {
        model: DriverGroupModel,
        resourceType: 'driver_group',
        memberResourceType: 'driver',
        memberPayloadKey: 'driverIds',
        read: 'viewVehicles',
        write: 'manageVehicles',
        libelle: 'conducteur',
      },
      membership,
      audit,
      auditLogs
    )
  }
}
