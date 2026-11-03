import db from '@adonisjs/lucid/services/db'

/**
 * =========================================================================
 *  AFFECTATIONS BOÎTIER ↔ VÉHICULE — accès SQL de DeviceController
 * =========================================================================
 *
 * `device_assignments.period` est un tstzrange ouvert à droite : l'affectation
 * EN COURS est celle dont `upper_inf(period)` est vrai. Les contraintes
 * EXCLUDE de la migration 3 (CM-01 / CM-02) interdisent qu'un boîtier soit
 * sur deux véhicules, ou un véhicule sur deux boîtiers, en même temps.
 *
 * Écrit en SQL brut : le query builder ne sait pas exprimer `tstzrange` ni
 * `upper_inf` dans un UPDATE.
 */

export interface CurrentAssignment {
  id: string
  registration: string
  installed_at: Date
}

export class LucidDeviceAssignments {
  /** Véhicule sur lequel le boîtier est monté, avec la date de pose ; null s'il est en stock. */
  async currentOf(deviceId: string): Promise<CurrentAssignment | null> {
    const r = await db.rawQuery(
      `SELECT v.id, v.registration, lower(da.period) AS installed_at
         FROM device_assignments da
         JOIN vehicles v ON v.id = da.vehicle_id
        WHERE da.device_id = :id AND upper_inf(da.period)
        LIMIT 1`,
      { id: deviceId }
    )
    return r.rows?.[0] ?? null
  }

  /** Vrai si le boîtier est monté en ce moment. */
  async isMounted(deviceId: string): Promise<boolean> {
    const r = await db.rawQuery(
      `SELECT 1 FROM device_assignments WHERE device_id = :id AND upper_inf(period) LIMIT 1`,
      { id: deviceId }
    )
    return Boolean(r.rows?.length)
  }

  /**
   * Le véhicule existe-t-il, actif, dans cette organisation ?
   * Contrôlé AVANT l'insertion : sinon un UUID inexistant remonte en violation
   * de clé étrangère illisible au lieu d'un « véhicule introuvable ».
   */
  async vehicleExists(vehicleId: string, organizationId: string): Promise<boolean> {
    const ligne = await db
      .from('vehicles')
      .where('id', vehicleId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return Boolean(ligne)
  }

  /**
   * Monte le boîtier sur le véhicule, en une transaction :
   * clôt l'affectation en cours, ouvre la nouvelle, passe le boîtier `active`.
   */
  async assign(input: {
    deviceId: string
    vehicleId: string
    actorId: string | null
    notes: string | null
  }): Promise<void> {
    await db.transaction(async (trx) => {
      await trx.rawQuery(
        `UPDATE device_assignments
            SET period = tstzrange(lower(period), now()), removed_by = :actor
          WHERE device_id = :device AND upper_inf(period)`,
        { device: input.deviceId, actor: input.actorId } as never
      )
      await trx.rawQuery(
        `INSERT INTO device_assignments (device_id, vehicle_id, period, installed_by, install_notes)
         VALUES (:device, :vehicle, tstzrange(now(), NULL), :actor, :notes)`,
        {
          device: input.deviceId,
          vehicle: input.vehicleId,
          actor: input.actorId,
          notes: input.notes,
        } as never
      )
      await trx.from('devices').where('id', input.deviceId).update({ status: 'active' })
    })
  }

  /** Démonte le boîtier. Faux s'il n'y avait aucune affectation en cours. */
  async unassign(deviceId: string, actorId: string | null): Promise<boolean> {
    const r = await db.rawQuery(
      `UPDATE device_assignments
          SET period = tstzrange(lower(period), now()), removed_by = :actor
        WHERE device_id = :device AND upper_inf(period)
        RETURNING id`,
      { device: deviceId, actor: actorId } as never
    )
    return Boolean(r.rows?.length)
  }
}
