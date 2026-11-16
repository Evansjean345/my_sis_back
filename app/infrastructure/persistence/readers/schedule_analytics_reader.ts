import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  CommandTally,
  LatencyStats,
  ScheduleAnalytics,
  ScheduleAnalyticsDay,
  ScheduleAnalyticsQuery,
  ScheduleAnalyticsReader,
} from '#application/scheduling/ports'

/**
 * =========================================================================
 *  ANALYSES DE L'IMMOBILISATION PLANIFIÉE — historique réel
 * =========================================================================
 *
 * Deux sources, complémentaires :
 *
 *   device_commands (origin = 'schedule')   ce que le moteur a ÉMIS et son issue
 *                                            (disponible depuis la migration 017)
 *   schedule_enforcement_events             ce qu'il a DÉCIDÉ : transitions, refus
 *                                            avant émission, dérogations, objectifs
 *                                            atteints (depuis la migration 020)
 *
 * Tout est agrégé en SQL (aucune ligne brute ne remonte), borné dans le temps
 * — index (organization_id, requested_at | occurred_at) — et ventilé par jour
 * et par heure dans le fuseau demandé (`AT TIME ZONE`), pas celui du serveur.
 */

const EMPTY_TALLY = (): CommandTally => ({
  requested: 0,
  acknowledged: 0,
  failed: 0,
  expired: 0,
  cancelled: 0,
  inFlight: 0,
})

const IN_FLIGHT = new Set(['approved', 'queued', 'sent'])

function count(tally: CommandTally, status: string, n: number) {
  tally.requested += n
  if (status === 'acknowledged') tally.acknowledged += n
  else if (status === 'failed') tally.failed += n
  else if (status === 'expired') tally.expired += n
  else if (status === 'cancelled') tally.cancelled += n
  else if (IN_FLIGHT.has(status)) tally.inFlight += n
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v))

function latency(row: Record<string, unknown> | undefined): LatencyStats {
  return {
    median: numOrNull(row?.median),
    p90: numOrNull(row?.p90),
    samples: num(row?.samples),
  }
}

export class LucidScheduleAnalyticsReader implements ScheduleAnalyticsReader {
  async analyze(query: ScheduleAnalyticsQuery): Promise<ScheduleAnalytics> {
    const { timezone } = query
    const startsAt = DateTime.fromISO(query.from, { zone: timezone }).startOf('day')
    const endsAt = DateTime.fromISO(query.to, { zone: timezone }).plus({ days: 1 }).startOf('day')
    const start = startsAt.toUTC().toISO()!
    const end = endsAt.toUTC().toISO()!

    /** Filtre d'organisation : vide = toutes (exploitant). */
    const scope = (column: string): [string, unknown[]] =>
      query.organizationIds.length > 0
        ? [`AND ${column} = ANY(?::uuid[])`, [query.organizationIds]]
        : ['', []]

    const [cScope, cBind] = scope('c.organization_id')
    const [eScope, eBind] = scope('e.organization_id')
    const cWhere = `c.origin = 'schedule' AND c.requested_at >= ? AND c.requested_at < ? ${cScope}`
    const eWhere = `e.occurred_at >= ? AND e.occurred_at < ? ${eScope}`
    const cArgs = [start, end, ...cBind]
    const eArgs = [start, end, ...eBind]

    const rows = async (sql: string, bindings: unknown[]) =>
      ((await db.rawQuery(sql, bindings)) as { rows: Record<string, unknown>[] }).rows

    const [
      commandCells,
      commandLatency,
      commandVehicles,
      eventCells,
      refusedPerDay,
      refusedTotal,
      executionDelay,
      refusalCodes,
      topVehicles,
      perSchedule,
      firstEvent,
    ] = await Promise.all([
      rows(
        `SELECT to_char(c.requested_at AT TIME ZONE ?, 'YYYY-MM-DD') AS day,
                EXTRACT(HOUR FROM c.requested_at AT TIME ZONE ?)::int AS hour,
                c.command_type, c.status, count(*)::int AS n
           FROM device_commands c
          WHERE ${cWhere}
          GROUP BY 1, 2, 3, 4`,
        [timezone, timezone, ...cArgs]
      ),
      rows(
        `SELECT c.command_type,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM c.acknowledged_at - c.requested_at)) AS median,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM c.acknowledged_at - c.requested_at)) AS p90,
                count(*)::int AS samples
           FROM device_commands c
          WHERE ${cWhere} AND c.status = 'acknowledged' AND c.acknowledged_at IS NOT NULL
          GROUP BY 1`,
        cArgs
      ),
      rows(
        `SELECT count(DISTINCT c.vehicle_id)::int AS n FROM device_commands c WHERE ${cWhere}`,
        cArgs
      ),
      rows(
        `SELECT to_char(e.occurred_at AT TIME ZONE ?, 'YYYY-MM-DD') AS day,
                EXTRACT(HOUR FROM e.occurred_at AT TIME ZONE ?)::int AS hour,
                e.kind, e.desired_state, count(*)::int AS n
           FROM schedule_enforcement_events e
          WHERE ${eWhere}
          GROUP BY 1, 2, 3, 4`,
        [timezone, timezone, ...eArgs]
      ),
      rows(
        `SELECT to_char(e.occurred_at AT TIME ZONE ?, 'YYYY-MM-DD') AS day,
                count(DISTINCT e.vehicle_id)::int AS n
           FROM schedule_enforcement_events e
          WHERE ${eWhere} AND e.kind = 'refused'
          GROUP BY 1`,
        [timezone, ...eArgs]
      ),
      rows(
        `SELECT count(DISTINCT e.vehicle_id)::int AS n
           FROM schedule_enforcement_events e
          WHERE ${eWhere} AND e.kind = 'refused'`,
        eArgs
      ),
      rows(
        `SELECT e.action,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM e.occurred_at - e.pending_since)) AS median,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM e.occurred_at - e.pending_since)) AS p90,
                count(*)::int AS samples
           FROM schedule_enforcement_events e
          WHERE ${eWhere} AND e.kind = 'completed' AND e.pending_since IS NOT NULL AND e.action IS NOT NULL
          GROUP BY 1`,
        eArgs
      ),
      rows(
        `SELECT e.error_code AS code, count(*)::int AS n, count(DISTINCT e.vehicle_id)::int AS vehicles
           FROM schedule_enforcement_events e
          WHERE ${eWhere} AND e.kind = 'refused'
          GROUP BY 1
          ORDER BY 2 DESC`,
        eArgs
      ),
      rows(
        `WITH cmd AS (
           SELECT c.vehicle_id,
                  count(*) FILTER (WHERE c.command_type = 'engine_cut')::int     AS cuts,
                  count(*) FILTER (WHERE c.command_type = 'engine_restore')::int AS restores,
                  count(*) FILTER (WHERE c.status IN ('failed','expired'))::int  AS failures
             FROM device_commands c
            WHERE ${cWhere} AND c.vehicle_id IS NOT NULL
            GROUP BY 1
         ), evt AS (
           SELECT e.vehicle_id,
                  count(*) FILTER (WHERE e.kind = 'refused')::int    AS refusals,
                  count(*) FILTER (WHERE e.kind = 'overridden')::int AS overrides
             FROM schedule_enforcement_events e
            WHERE ${eWhere}
            GROUP BY 1
         )
         SELECT v.id, v.registration, v.organization_id,
                COALESCE(cmd.cuts, 0) AS cuts, COALESCE(cmd.restores, 0) AS restores,
                COALESCE(cmd.failures, 0) AS failures,
                COALESCE(evt.refusals, 0) AS refusals, COALESCE(evt.overrides, 0) AS overrides
           FROM cmd
           FULL JOIN evt ON evt.vehicle_id = cmd.vehicle_id
           JOIN vehicles v ON v.id = COALESCE(cmd.vehicle_id, evt.vehicle_id)
          ORDER BY COALESCE(cmd.failures, 0) + COALESCE(evt.refusals, 0) DESC,
                   COALESCE(evt.overrides, 0) DESC, COALESCE(cmd.cuts, 0) DESC, v.registration
          LIMIT 10`,
        [...cArgs, ...eArgs]
      ),
      rows(
        `SELECT s.id, s.name, s.organization_id,
                count(*) FILTER (WHERE e.kind = 'transition' AND e.desired_state = 'immobilized')::int AS transitions,
                count(*) FILTER (WHERE e.kind = 'dispatched')::int AS dispatched,
                count(*) FILTER (WHERE e.kind = 'dispatched' AND c.status = 'acknowledged')::int AS acknowledged,
                count(*) FILTER (WHERE e.kind = 'refused')::int AS refusals,
                count(*) FILTER (WHERE e.kind = 'overridden')::int AS overrides,
                count(*) FILTER (WHERE e.kind = 'completed')::int AS completed,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM e.occurred_at - e.pending_since))
                  FILTER (WHERE e.kind = 'completed' AND e.pending_since IS NOT NULL) AS median_execution
           FROM schedule_enforcement_events e
           JOIN usage_schedules s ON s.id = e.usage_schedule_id
           LEFT JOIN device_commands c ON c.id = e.command_id
          WHERE ${eWhere}
          GROUP BY s.id, s.name, s.organization_id
          ORDER BY transitions DESC, refusals DESC, s.name`,
        eArgs
      ),
      rows(
        `SELECT min(e.occurred_at) AS since FROM schedule_enforcement_events e WHERE TRUE ${eScope}`,
        eBind
      ),
    ])

    // ------------------------------------------------------------ jours (tous, même vides)
    const days = new Map<string, ScheduleAnalyticsDay>()
    for (let d = startsAt; d < endsAt; d = d.plus({ days: 1 })) {
      const date = d.toISODate()!
      days.set(date, {
        date,
        cut: EMPTY_TALLY(),
        restore: EMPTY_TALLY(),
        refusals: 0,
        refusedVehicles: 0,
        overrides: 0,
        manualCutsKept: 0,
        transitionsToImmobilized: 0,
        transitionsToFree: 0,
        completed: 0,
        hours: {
          cut: Array.from({ length: 24 }, () => 0),
          restore: Array.from({ length: 24 }, () => 0),
          refused: Array.from({ length: 24 }, () => 0),
        },
      })
    }

    const totalCut = EMPTY_TALLY()
    const totalRestore = EMPTY_TALLY()
    for (const r of commandCells) {
      const day = days.get(String(r.day))
      const n = num(r.n)
      const hour = num(r.hour)
      const status = String(r.status)
      if (r.command_type === 'engine_cut') {
        count(totalCut, status, n)
        if (day) {
          count(day.cut, status, n)
          day.hours.cut[hour] += n
        }
      } else if (r.command_type === 'engine_restore') {
        count(totalRestore, status, n)
        if (day) {
          count(day.restore, status, n)
          day.hours.restore[hour] += n
        }
      }
    }

    const totals = {
      refusals: 0,
      overrides: 0,
      manualCutsKept: 0,
      alreadyImmobilized: 0,
      transitionsToImmobilized: 0,
      transitionsToFree: 0,
    }
    for (const r of eventCells) {
      const day = days.get(String(r.day))
      const n = num(r.n)
      switch (r.kind) {
        case 'refused':
          totals.refusals += n
          if (day) {
            day.refusals += n
            day.hours.refused[num(r.hour)] += n
          }
          break
        case 'overridden':
          totals.overrides += n
          if (day) day.overrides += n
          break
        case 'manual_cut_kept':
          totals.manualCutsKept += n
          if (day) day.manualCutsKept += n
          break
        case 'already_immobilized':
          totals.alreadyImmobilized += n
          break
        case 'completed':
          if (day) day.completed += n
          break
        case 'transition':
          if (r.desired_state === 'immobilized') {
            totals.transitionsToImmobilized += n
            if (day) day.transitionsToImmobilized += n
          } else {
            totals.transitionsToFree += n
            if (day) day.transitionsToFree += n
          }
          break
      }
    }
    for (const r of refusedPerDay) {
      const day = days.get(String(r.day))
      if (day) day.refusedVehicles = num(r.n)
    }

    const byType = (list: Record<string, unknown>[], key: string, value: string) =>
      list.find((r) => r[key] === value)
    const since = firstEvent[0]?.since

    return {
      range: {
        from: query.from,
        to: query.to,
        timezone,
        startsAt: startsAt.toISO()!,
        endsAt: endsAt.toISO()!,
      },
      totals: {
        cut: totalCut,
        restore: totalRestore,
        refusedVehicles: num(refusedTotal[0]?.n),
        vehicles: num(commandVehicles[0]?.n),
        ...totals,
        commandLatency: {
          cut: latency(byType(commandLatency, 'command_type', 'engine_cut')),
          restore: latency(byType(commandLatency, 'command_type', 'engine_restore')),
        },
        executionDelay: {
          cut: latency(byType(executionDelay, 'action', 'cut')),
          restore: latency(byType(executionDelay, 'action', 'restore')),
        },
      },
      refusalsByCode: refusalCodes.map((r) => ({
        code: String(r.code),
        count: num(r.n),
        vehicles: num(r.vehicles),
      })),
      days: [...days.values()],
      vehicles: topVehicles.map((r) => ({
        id: String(r.id),
        registration: (r.registration as string | null) ?? null,
        organizationId: String(r.organization_id),
        cuts: num(r.cuts),
        restores: num(r.restores),
        failures: num(r.failures),
        refusals: num(r.refusals),
        overrides: num(r.overrides),
      })),
      schedules: perSchedule.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        organizationId: String(r.organization_id),
        transitionsToImmobilized: num(r.transitions),
        dispatched: num(r.dispatched),
        acknowledged: num(r.acknowledged),
        refusals: num(r.refusals),
        overrides: num(r.overrides),
        completed: num(r.completed),
        medianExecutionSeconds: numOrNull(r.median_execution),
      })),
      journalSince: since
        ? DateTime.fromJSDate(since instanceof Date ? since : new Date(String(since)))
            .toUTC()
            .toISO()
        : null,
    }
  }
}
