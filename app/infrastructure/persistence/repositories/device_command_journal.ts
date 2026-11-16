import db from '@adonisjs/lucid/services/db'
import { IN_FLIGHT_STATUSES } from '#domain/security/value_objects'

/**
 * =========================================================================
 *  JOURNAL DES COMMANDES BOÎTIER — accès SQL de DeviceCommandController
 * =========================================================================
 *
 * Toutes les lectures et écritures de `device_commands` / `device_command_logs`
 * faites pour les commandes génériques (hors immobilisation, qui passe par
 * l'agrégat DeviceCommand et LucidDeviceCommandRepository).
 *
 * Le contrôleur ne voit plus la base : il appelle ces méthodes. Règle de
 * dépendance respectée (`npm run arch` : aucun accès direct hors
 * infrastructure).
 *
 * Principe inchangé : toute commande est TRACÉE avant émission, et chaque
 * changement de statut écrit la commande ET son journal dans la même
 * transaction.
 */

/** Acteur d'une transition, tel que porté par le contexte d'exécution HTTP. */
export interface CommandActor {
  actorId: string | null
  ip?: string | null
}

export interface InFlightCommand {
  id: string
  status: string
  command_type: string
  expires_at: Date
}

export interface AwaitingProviderCommand {
  id: string
  status: string
  provider_command_id: string | null
}

export interface QueuedCommandRecord {
  id: string
  organizationId: string
  deviceId: string
  vehicleId: string | null
  commandType: string
  reason: string
  requestedBy: string | null
  /** Hors coupure moteur, CM-07 ne s'applique pas : seuil neutre. */
  safetySpeedLimitKph: number
  queuedAt: string
  expiresAt: string
  safetyContext: Record<string, unknown>
}

export interface CommandLabels {
  vehicles: Record<string, { id: string; registration: string; label: string | null }>
  devices: Record<string, { id: string; imei: string; model: string | null }>
}

/** Colonnes de l'historique d'un boîtier (contrat de GET /devices/:id/commands/history). */
const HISTORY_COLUMNS = [
  'id',
  'command_type',
  'status',
  'reason',
  'origin',
  'requested_by',
  'requested_at',
  'sent_at',
  'acknowledged_at',
  'failed_at',
  'expires_at',
  'error_message',
  'provider_command_id',
  'safety_context',
] as const

export class LucidDeviceCommandJournal {
  /**
   * Immatriculation et IMEI des lignes d'une page du journal : deux requêtes
   * pour toute la page, jamais une par ligne. Cloisonné à l'organisation.
   */
  async labelsFor(
    organizationId: string,
    vehicleIds: string[],
    deviceIds: string[]
  ): Promise<CommandLabels> {
    const [vehicules, boitiers] = await Promise.all([
      vehicleIds.length
        ? db
            .from('vehicles')
            .whereIn('id', vehicleIds)
            .where('organization_id', organizationId)
            .select('id', 'registration', 'label')
        : [],
      deviceIds.length
        ? db
            .from('devices')
            .whereIn('id', deviceIds)
            .where('organization_id', organizationId)
            .select('id', 'imei', 'model')
        : [],
    ])
    return {
      vehicles: Object.fromEntries(vehicules.map((l) => [l.id, l])),
      devices: Object.fromEntries(boitiers.map((l) => [l.id, l])),
    }
  }

  /**
   * Les 50 dernières commandes d'un boîtier.
   * `organizationId: null` = périmètre plateforme (routes admin).
   */
  async history(deviceId: string, organizationId: string | null, limit = 50) {
    const query = db.from('device_commands').where('device_id', deviceId)
    if (organizationId !== null) query.where('organization_id', organizationId)
    return query
      .orderBy('requested_at', 'desc')
      .limit(limit)
      .select(...HISTORY_COLUMNS)
  }

  /** Commande en vol sur ce boîtier (contrainte CM-09), ou null. */
  async findInFlight(deviceId: string): Promise<InFlightCommand | null> {
    const ligne = await db
      .from('device_commands')
      .where('device_id', deviceId)
      .whereIn('status', [...IN_FLIGHT_STATUSES])
      .select('id', 'status', 'command_type', 'expires_at')
      .first()
    return ligne ?? null
  }

  /** Commande encore chez le fournisseur (queued / sent) : seule annulable. */
  async findAwaitingProvider(
    commandId: string,
    deviceId: string
  ): Promise<AwaitingProviderCommand | null> {
    const ligne = await db
      .from('device_commands')
      .where('id', commandId)
      .where('device_id', deviceId)
      .whereIn('status', ['queued', 'sent'])
      .select('id', 'status', 'provider_command_id')
      .first()
    return ligne ?? null
  }

  /** Véhicule sur lequel le boîtier est monté en ce moment, ou null. */
  async currentVehicleId(deviceId: string): Promise<string | null> {
    const ligne = await db
      .from('device_assignments')
      .where('device_id', deviceId)
      .whereRaw('upper_inf(period)')
      .select('vehicle_id')
      .first()
    return ligne?.vehicle_id ?? null
  }

  /** ① Trace AVANT émission : la commande existe en base avant de partir. */
  async insertQueued(r: QueuedCommandRecord): Promise<void> {
    await db.table('device_commands').insert({
      id: r.id,
      organization_id: r.organizationId,
      device_id: r.deviceId,
      vehicle_id: r.vehicleId,
      command_type: r.commandType,
      status: 'queued',
      reason: r.reason,
      origin: 'manual',
      requested_by: r.requestedBy,
      requested_at: r.queuedAt,
      safety_speed_limit_kph: r.safetySpeedLimitKph,
      queued_at: r.queuedAt,
      expires_at: r.expiresAt,
      attempts: 0,
      safety_context: JSON.stringify(r.safetyContext),
    })
  }

  /**
   * Changement de statut : la commande ET son journal, dans une transaction.
   * `fields` = colonnes supplémentaires (sent_at, error_message…).
   */
  async transition(
    commandId: string,
    from: string,
    to: string,
    actor: CommandActor,
    payload: Record<string, unknown>,
    fields: Record<string, unknown> = {}
  ): Promise<void> {
    await db.transaction(async (trx) => {
      await trx
        .from('device_commands')
        .where('id', commandId)
        .update({ status: to, ...fields })
      await trx.table('device_command_logs').insert({
        command_id: commandId,
        status_from: from,
        status_to: to,
        actor_id: actor.actorId,
        actor_type: 'user',
        actor_ip: actor.ip ?? null,
        payload: JSON.stringify(payload),
      })
    })
  }
}
