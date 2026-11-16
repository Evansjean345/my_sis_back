import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type {
  AssignmentChange,
  ScheduleTargetView,
  ScheduleWindowView,
  UsageScheduleRepository,
} from '#application/scheduling/ports'
import type { ScheduleMode, WeeklyWindow } from '#domain/scheduling/value_objects'

/** Identifiant neutre pour un `whereIn` vide : évite un `IN ()` invalide en SQL. */
const AUCUN = '00000000-0000-0000-0000-000000000000'

interface TargetTables {
  pivot: 'vehicle_schedules' | 'vehicle_schedule_groups'
  column: 'vehicle_id' | 'vehicle_group_id'
  table: 'vehicles' | 'vehicle_groups'
  label: 'registration' | 'name'
}

const VEHICLES: TargetTables = {
  pivot: 'vehicle_schedules',
  column: 'vehicle_id',
  table: 'vehicles',
  label: 'registration',
}
const GROUPS: TargetTables = {
  pivot: 'vehicle_schedule_groups',
  column: 'vehicle_group_id',
  table: 'vehicle_groups',
  label: 'name',
}

/** `time` PostgreSQL (`08:00:00`) → `08:00` pour l'API ; `24:00:00` reste `24:00`. */
function hhmm(value: string): string {
  const [h, m, s] = String(value).split(':')
  return s && s !== '00' ? `${h}:${m}:${s}` : `${h}:${m}`
}

/**
 * Administration des calendriers d'utilisation.
 *
 * Deux règles tenues ICI, à l'endroit où la requête est écrite :
 *
 *  - ATOMICITÉ des plages : un calendrier et sa semaine s'écrivent dans la
 *    même transaction. Un calendrier publié sans ses plages immobiliserait
 *    toute sa flotte (`allowed` sans plage = jamais autorisé).
 *
 *  - CLOISONNEMENT des rattachements : les identifiants candidats sont
 *    filtrés sur l'organisation du calendrier. Un véhicule d'un autre client
 *    ressort en `rejected`, comme un identifiant inconnu. La base tient le
 *    même invariant par trigger (migration 017).
 */
export class LucidUsageScheduleRepository implements UsageScheduleRepository {
  async create(input: {
    organizationId: string
    name: string
    description: string | null
    timezone: string
    isActive: boolean
    windows: readonly WeeklyWindow[]
  }): Promise<string> {
    return db.transaction(async (trx) => {
      const [ligne] = await trx
        .table('usage_schedules')
        .insert({
          organization_id: input.organizationId,
          name: input.name,
          description: input.description,
          timezone: input.timezone,
          is_active: input.isActive,
        })
        .returning('id')
      const id = String(typeof ligne === 'object' ? ligne.id : ligne)
      await this.insertWindows(trx, id, input.windows)
      return id
    })
  }

  async replaceWindows(scheduleId: string, windows: readonly WeeklyWindow[]): Promise<void> {
    await db.transaction(async (trx) => {
      await trx.from('schedule_windows').where('usage_schedule_id', scheduleId).delete()
      await this.insertWindows(trx, scheduleId, windows)
      // Une modification des plages est une modification du calendrier.
      await trx
        .from('usage_schedules')
        .where('id', scheduleId)
        .update({ updated_at: db.raw('now()') })
    })
  }

  async windowsOf(scheduleIds: string[]): Promise<Record<string, ScheduleWindowView[]>> {
    if (scheduleIds.length === 0) return {}
    const rows = await db
      .from('schedule_windows')
      .whereIn('usage_schedule_id', scheduleIds)
      .orderBy(['usage_schedule_id', 'day_of_week', 'start_time'])
      .select('id', 'usage_schedule_id', 'day_of_week', 'start_time', 'end_time')

    const out: Record<string, ScheduleWindowView[]> = Object.fromEntries(
      scheduleIds.map((id) => [id, []])
    )
    for (const r of rows) {
      out[r.usage_schedule_id].push({
        id: r.id,
        dayOfWeek: Number(r.day_of_week),
        startTime: hhmm(r.start_time),
        endTime: hhmm(r.end_time),
      })
    }
    return out
  }

  async countTargets(
    scheduleIds: string[]
  ): Promise<Record<string, { vehicles: number; groups: number }>> {
    if (scheduleIds.length === 0) return {}
    const compter = async (t: TargetTables) => {
      const rows = await db
        .from(`${t.pivot} as p`)
        .innerJoin(`${t.table} as x`, 'x.id', `p.${t.column}`)
        .whereIn('p.usage_schedule_id', scheduleIds)
        .whereNull('x.deleted_at')
        .groupBy('p.usage_schedule_id')
        .select('p.usage_schedule_id as sid')
        .count('* as total')
      return Object.fromEntries(rows.map((r) => [r.sid, Number(r.total)]))
    }
    const [vehicules, groupes] = await Promise.all([compter(VEHICLES), compter(GROUPS)])
    return Object.fromEntries(
      scheduleIds.map((id) => [id, { vehicles: vehicules[id] ?? 0, groups: groupes[id] ?? 0 }])
    )
  }

  vehiclesOf(scheduleId: string): Promise<ScheduleTargetView[]> {
    return this.targetsOf(VEHICLES, scheduleId)
  }

  groupsOf(scheduleId: string): Promise<ScheduleTargetView[]> {
    return this.targetsOf(GROUPS, scheduleId)
  }

  attachVehicles(
    scheduleId: string,
    organizationId: string,
    vehicleIds: string[],
    mode: ScheduleMode
  ): Promise<AssignmentChange> {
    return this.attach(VEHICLES, scheduleId, organizationId, vehicleIds, mode)
  }

  attachGroups(
    scheduleId: string,
    organizationId: string,
    groupIds: string[],
    mode: ScheduleMode
  ): Promise<AssignmentChange> {
    return this.attach(GROUPS, scheduleId, organizationId, groupIds, mode)
  }

  detachVehicle(scheduleId: string, vehicleId: string): Promise<boolean> {
    return this.detach(VEHICLES, scheduleId, vehicleId)
  }

  detachGroup(scheduleId: string, groupId: string): Promise<boolean> {
    return this.detach(GROUPS, scheduleId, groupId)
  }

  async vehicleIdsOfGroups(groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return []
    const rows = await db
      .from('vehicle_group_members as m')
      .innerJoin('vehicles as v', 'v.id', 'm.vehicle_id')
      .whereIn('m.vehicle_group_id', groupIds)
      .whereNull('v.deleted_at')
      .distinct('m.vehicle_id')
    return rows.map((r) => r.vehicle_id as string)
  }

  async schedulesOfGroup(groupId: string) {
    const rows = await db
      .from('vehicle_schedule_groups as p')
      .innerJoin('usage_schedules as s', 's.id', 'p.usage_schedule_id')
      .where('p.vehicle_group_id', groupId)
      .whereNull('s.deleted_at')
      .orderBy('s.name')
      .select('s.id', 's.name', 'p.mode', 's.is_active')
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      mode: r.mode as ScheduleMode,
      isActive: Boolean(r.is_active),
    }))
  }

  // -------------------------------------------------------------------------

  private async insertWindows(
    trx: TransactionClientContract,
    scheduleId: string,
    windows: readonly WeeklyWindow[]
  ) {
    if (windows.length === 0) return
    await trx.table('schedule_windows').multiInsert(
      windows.map((w) => {
        const r = w.toRow()
        return {
          usage_schedule_id: scheduleId,
          day_of_week: r.dayOfWeek,
          start_time: r.startTime,
          end_time: r.endTime,
        }
      })
    )
  }

  private async targetsOf(t: TargetTables, scheduleId: string): Promise<ScheduleTargetView[]> {
    const rows = await db
      .from(`${t.pivot} as p`)
      .innerJoin(`${t.table} as x`, 'x.id', `p.${t.column}`)
      .where('p.usage_schedule_id', scheduleId)
      .whereNull('x.deleted_at')
      .orderBy(`x.${t.label}`)
      .select('x.id', `x.${t.label} as label`, 'p.mode', 'p.created_at')
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      mode: r.mode as ScheduleMode,
      createdAt: r.created_at,
    }))
  }

  private async attach(
    t: TargetTables,
    scheduleId: string,
    organizationId: string,
    ids: string[],
    mode: ScheduleMode
  ): Promise<AssignmentChange> {
    const candidats = [...new Set(ids)]

    const eligibles = await db
      .from(t.table)
      .whereIn('id', candidats)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
    const eligibleIds = eligibles.map((r) => r.id as string)

    const existants = await db
      .from(t.pivot)
      .where('usage_schedule_id', scheduleId)
      .whereIn(t.column, eligibleIds.length > 0 ? eligibleIds : [AUCUN])
      .select(`${t.column} as id`, 'mode')
    const modeActuel = new Map(existants.map((r) => [r.id as string, r.mode as string]))

    const applied = eligibleIds.filter((id) => !modeActuel.has(id))
    const updated = eligibleIds.filter((id) => modeActuel.has(id) && modeActuel.get(id) !== mode)
    const unchanged = eligibleIds.filter((id) => modeActuel.get(id) === mode)

    await db.transaction(async (trx) => {
      if (applied.length > 0) {
        await trx
          .table(t.pivot)
          .multiInsert(
            applied.map((id) => ({ [t.column]: id, usage_schedule_id: scheduleId, mode }))
          )
      }
      if (updated.length > 0) {
        await trx
          .from(t.pivot)
          .where('usage_schedule_id', scheduleId)
          .whereIn(t.column, updated)
          .update({ mode })
      }
    })

    return {
      applied,
      updated,
      unchanged,
      rejected: candidats.filter((id) => !eligibleIds.includes(id)),
    }
  }

  private async detach(t: TargetTables, scheduleId: string, targetId: string): Promise<boolean> {
    const n = await db
      .from(t.pivot)
      .where('usage_schedule_id', scheduleId)
      .where(t.column, targetId)
      .delete()
    return Number(Array.isArray(n) ? n.length : n) > 0
  }
}
