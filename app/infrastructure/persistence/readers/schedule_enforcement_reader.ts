import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  EnforcementReader,
  EnforcementState,
  EnforcementStateStore,
  EnforcementTarget,
  EnforcementEvent,
  EnforcementEventLog,
} from '#application/scheduling/ports'
import type { ScheduleAssignment, UsageCause } from '#domain/scheduling/usage_policy'
import { WeeklyWindow, type ScheduleMode } from '#domain/scheduling/value_objects'
import type { EnforcementAction, EnforcementOutcome } from '#domain/scheduling/enforcement_policy'

interface AssignmentRow {
  vehicle_id: string
  usage_schedule_id: string
  mode: ScheduleMode
  source_type: 'vehicle' | 'group'
  group_id: string | null
  group_name: string | null
  schedule_name: string
  timezone: string
}

const toDate = (v: unknown): Date | null => (v ? new Date(v as string) : null)

/**
 * =========================================================================
 *  LECTURE DU MOTEUR D'IMMOBILISATION PLANIFIÉE
 * =========================================================================
 *
 * Tout ce que le moteur doit savoir, pour TOUS les véhicules concernés, en
 * un nombre de requêtes CONSTANT (six), quelle que soit la taille de la
 * flotte : calendriers applicables, plages, mémoire, dernière commande
 * confirmée, commande en vol, dernière intervention humaine.
 *
 * Un véhicule hérite des calendriers de ses groupes : la jointure
 * `vehicle_schedule_groups → vehicle_group_members` est faite ici, au moment
 * de la lecture. Ajouter un véhicule à un groupe suffit donc à lui appliquer
 * le calendrier du groupe dès le passage suivant — aucune recopie.
 */
export class LucidEnforcementReader implements EnforcementReader {
  async listTargets(
    filter: { vehicleIds?: string[]; organizationId?: string } = {}
  ): Promise<EnforcementTarget[]> {
    if (filter.vehicleIds && filter.vehicleIds.length === 0) return []

    // ---- ① calendriers ACTIFS applicables, directs et hérités des groupes
    const conditions: string[] = []
    const bindings: unknown[] = []
    if (filter.vehicleIds) {
      // Tableau transmis tel quel à pg : `rawQuery` ne déplie pas `IN (?)`.
      conditions.push('a.vehicle_id = ANY(?::uuid[])')
      bindings.push(filter.vehicleIds)
    }
    if (filter.organizationId) {
      conditions.push('v.organization_id = ?')
      bindings.push(filter.organizationId)
    }
    const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

    const assignments = (await db.rawQuery(
      `WITH a AS (
         SELECT vs.vehicle_id, vs.usage_schedule_id, vs.mode,
                'vehicle'::text AS source_type, NULL::uuid AS group_id, NULL::text AS group_name
           FROM vehicle_schedules vs
         UNION ALL
         SELECT m.vehicle_id, vsg.usage_schedule_id, vsg.mode,
                'group'::text, g.id, g.name
           FROM vehicle_schedule_groups vsg
           JOIN vehicle_groups g        ON g.id = vsg.vehicle_group_id AND g.deleted_at IS NULL
           JOIN vehicle_group_members m ON m.vehicle_group_id = g.id
       )
       SELECT a.*, s.name AS schedule_name, s.timezone
         FROM a
         JOIN usage_schedules s ON s.id = a.usage_schedule_id
                               AND s.is_active AND s.deleted_at IS NULL
         JOIN vehicles v        ON v.id = a.vehicle_id
                               AND v.deleted_at IS NULL AND v.status <> 'archived'
        WHERE true ${where}
        ORDER BY a.vehicle_id, s.name`,
      bindings
    )) as { rows: AssignmentRow[] }

    // ---- ② véhicules encore GÉRÉS par le moteur (à libérer si leur calendrier a disparu)
    const geres = db
      .from('vehicle_schedule_states as st')
      .join('vehicles as v', 'v.id', 'st.vehicle_id')
      .whereNull('v.deleted_at')
      .where((q) => q.whereNotNull('st.pending_action').orWhere('st.desired_state', 'immobilized'))
      .select('st.vehicle_id')
    if (filter.vehicleIds) geres.whereIn('st.vehicle_id', filter.vehicleIds)
    if (filter.organizationId) geres.where('v.organization_id', filter.organizationId)

    const lignesGerees = await geres
    const ids = [
      ...new Set([
        ...assignments.rows.map((r) => r.vehicle_id),
        ...lignesGerees.map((r) => r.vehicle_id as string),
      ]),
    ]
    if (ids.length === 0) return []

    const scheduleIds = [...new Set(assignments.rows.map((r) => r.usage_schedule_id))]

    const [vehicules, fenetres, etats, confirmees, enVol, operateur] = await Promise.all([
      db.from('vehicles').whereIn('id', ids).select('id', 'organization_id', 'registration'),

      scheduleIds.length
        ? db
            .from('schedule_windows')
            .whereIn('usage_schedule_id', scheduleIds)
            .select('usage_schedule_id', 'day_of_week', 'start_time', 'end_time')
        : Promise.resolve([]),

      db.from('vehicle_schedule_states').whereIn('vehicle_id', ids).select('*'),

      // ---- dernière commande moteur CONFIRMÉE par le boîtier
      db
        .from('device_commands')
        .whereIn('vehicle_id', ids)
        .whereIn('command_type', ['engine_cut', 'engine_restore'])
        .where('status', 'acknowledged')
        .distinctOn('vehicle_id')
        .orderBy([
          { column: 'vehicle_id' },
          { column: 'acknowledged_at', order: 'desc', nulls: 'last' },
        ])
        .select('vehicle_id', 'command_type', 'origin', 'acknowledged_at'),

      // ---- commande occupant le boîtier (CM-09)
      db
        .from('device_commands')
        .whereIn('vehicle_id', ids)
        .whereIn('status', ['approved', 'queued', 'sent'])
        .distinct('vehicle_id'),

      // ---- dernière intervention d'un humain ou d'une intégration
      db
        .from('device_commands')
        .whereIn('vehicle_id', ids)
        .whereIn('command_type', ['engine_cut', 'engine_restore'])
        .whereNot('origin', 'schedule')
        .whereNot('status', 'cancelled')
        .groupBy('vehicle_id')
        .select('vehicle_id')
        .max('requested_at as last_at'),
    ])

    const plages = new Map<string, WeeklyWindow[]>()
    for (const f of fenetres as Array<Record<string, unknown>>) {
      const liste = plages.get(f.usage_schedule_id as string) ?? []
      liste.push(
        WeeklyWindow.trusted(Number(f.day_of_week), String(f.start_time), String(f.end_time))
      )
      plages.set(f.usage_schedule_id as string, liste)
    }

    const parVehicule = new Map<string, ScheduleAssignment[]>()
    for (const r of assignments.rows) {
      const liste = parVehicule.get(r.vehicle_id) ?? []
      liste.push({
        scheduleId: r.usage_schedule_id,
        scheduleName: r.schedule_name,
        timezone: r.timezone,
        mode: r.mode,
        windows: plages.get(r.usage_schedule_id) ?? [],
        source:
          r.source_type === 'group'
            ? { type: 'group', groupId: r.group_id!, groupName: r.group_name ?? '' }
            : { type: 'vehicle' },
      })
      parVehicule.set(r.vehicle_id, liste)
    }

    const etatPar = new Map(etats.map((e) => [e.vehicle_id as string, toState(e)]))
    const confirmeePar = new Map(confirmees.map((c) => [c.vehicle_id as string, c]))
    const enVolSet = new Set(enVol.map((c) => c.vehicle_id as string))
    const operateurPar = new Map(operateur.map((o) => [o.vehicle_id as string, toDate(o.last_at)]))

    return vehicules.map((v) => {
      const c = confirmeePar.get(v.id)
      return {
        vehicleId: v.id,
        organizationId: v.organization_id,
        registration: v.registration,
        assignments: parVehicule.get(v.id) ?? [],
        state: etatPar.get(v.id) ?? null,
        lastConfirmed: c
          ? {
              commandType: c.command_type,
              origin: c.origin,
              at: toDate(c.acknowledged_at) ?? new Date(0),
            }
          : null,
        commandInFlight: enVolSet.has(v.id),
        lastOperatorCommandAt: operateurPar.get(v.id) ?? null,
      }
    })
  }
}

function toState(e: Record<string, unknown>): EnforcementState {
  return {
    vehicleId: e.vehicle_id as string,
    organizationId: e.organization_id as string,
    desired: e.desired_state as 'free' | 'immobilized',
    cause: e.cause as UsageCause,
    scheduleId: (e.usage_schedule_id as string) ?? null,
    pendingAction: (e.pending_action as EnforcementAction) ?? null,
    pendingSince: toDate(e.pending_since),
    nextAttemptAt: toDate(e.next_attempt_at),
    attempts: Number(e.attempts ?? 0),
    lastErrorCode: (e.last_error_code as string) ?? null,
    lastErrorMessage: (e.last_error_message as string) ?? null,
    lastCommandId: (e.last_command_id as string) ?? null,
    lastOutcome: (e.last_outcome as EnforcementOutcome) ?? null,
    evaluatedAt: toDate(e.evaluated_at) ?? new Date(0),
  }
}

/** Mémoire du moteur : une ligne par véhicule, réécrite seulement quand elle change. */
export class LucidEnforcementStateStore implements EnforcementStateStore {
  async save(s: EnforcementState): Promise<void> {
    const iso = (d: Date | null) => (d ? DateTime.fromJSDate(d).toISO() : null)
    await db
      .table('vehicle_schedule_states')
      .insert({
        vehicle_id: s.vehicleId,
        organization_id: s.organizationId,
        desired_state: s.desired,
        cause: s.cause,
        usage_schedule_id: s.scheduleId,
        pending_action: s.pendingAction,
        pending_since: iso(s.pendingSince),
        next_attempt_at: iso(s.nextAttemptAt),
        attempts: s.attempts,
        last_error_code: s.lastErrorCode,
        last_error_message: s.lastErrorMessage,
        last_command_id: s.lastCommandId,
        last_outcome: s.lastOutcome,
        evaluated_at: iso(s.evaluatedAt),
      })
      .onConflict('vehicle_id')
      .merge()
  }
}

/** Journal d'exécution : une insertion groupée par véhicule et par passage, jamais de mise à jour. */
export class LucidEnforcementEventLog implements EnforcementEventLog {
  async record(events: EnforcementEvent[]): Promise<void> {
    if (events.length === 0) return
    const iso = (d: Date | null) => (d ? DateTime.fromJSDate(d).toISO() : null)
    await db.table('schedule_enforcement_events').multiInsert(
      events.map((e) => ({
        organization_id: e.organizationId,
        vehicle_id: e.vehicleId,
        usage_schedule_id: e.scheduleId,
        vehicle_group_id: e.vehicleGroupId,
        kind: e.kind,
        desired_state: e.desired,
        action: e.action,
        command_id: e.commandId,
        error_code: e.errorCode,
        pending_since: iso(e.pendingSince),
        occurred_at: iso(e.occurredAt),
      }))
    )
  }
}
