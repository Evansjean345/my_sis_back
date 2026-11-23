import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type {
  ConditionTarget,
  EventType,
  LatLng,
  RuleActionType,
  RuleField,
  RuleOperator,
  Severity,
  SpeedScope,
} from '#domain/policy/rule_policy'

/**
 * =========================================================================
 *  MOTEUR DE RÈGLES — persistance (zones, politiques de vitesse, règles)
 * =========================================================================
 *
 * Lectures et écritures SQL des trois ressources, au format attendu par le
 * tableau de bord. `organizationId = null` : toutes les organisations
 * (Super Admin) ; sinon, une seule.
 *
 * Géométrie (PostGIS) : un cercle est stocké en polygone (`ST_Buffer` du
 * centre) avec son centre et son rayon ; un polygone, en MultiPolygon fermé.
 */

type Executor = TransactionClientContract | typeof db
interface OrganizationRef {
  id: string
  name: string
  code: string
}

// =========================================================================
//  Zones
// =========================================================================

export interface GeofenceDto {
  id: string
  organizationId: string
  organization: OrganizationRef
  name: string
  description: string | null
  shape: 'circle' | 'polygon'
  center: LatLng | null
  radiusM: number | null
  points: LatLng[]
  kind: 'authorized' | 'forbidden'
  alertOnEntry: boolean
  alertOnExit: boolean
  vehicleIds: string[]
  color: string
  active: boolean
  updatedAt: string
}

export interface GeofenceInput {
  organizationId: string
  name: string
  description: string | null
  shape: 'circle' | 'polygon'
  center: LatLng | null
  radiusM: number | null
  points: LatLng[]
  kind: 'authorized' | 'forbidden'
  alertOnEntry: boolean
  alertOnExit: boolean
  vehicleIds: string[]
  color: string
  active: boolean
}

const DEFAULT_COLOR = '#2563eb'

function ring(geojson: string | null): LatLng[] {
  if (!geojson) return []
  const g = JSON.parse(geojson) as { coordinates: number[][][][] }
  const outer = g.coordinates?.[0]?.[0] ?? []
  return outer.slice(0, -1).map(([lng, lat]) => ({ lat, lng }))
}

export async function listGeofences(organizationId: string | null): Promise<GeofenceDto[]> {
  const rows = await db
    .from('geofences as g')
    .join('organizations as o', 'o.id', 'g.organization_id')
    .whereNull('g.deleted_at')
    .whereIn('g.kind', ['authorized', 'forbidden'])
    .if(organizationId !== null, (q) => q.where('g.organization_id', organizationId!))
    .orderBy('g.name')
    .select(
      'g.id',
      'g.organization_id',
      'g.name',
      'g.description',
      'g.shape_type',
      'g.kind',
      'g.alert_on_entry',
      'g.alert_on_exit',
      'g.color',
      'g.is_active',
      'g.updated_at',
      'g.radius_m',
      'o.name as org_name',
      'o.code as org_code',
      db.raw('ST_Y(g.center::geometry) as center_lat'),
      db.raw('ST_X(g.center::geometry) as center_lng'),
      db.raw('ST_AsGeoJSON(g.geom) as geojson'),
      db.raw(`COALESCE((SELECT array_agg(a.vehicle_id ORDER BY a.created_at)
                FROM geofence_assignments a
                WHERE a.geofence_id = g.id AND a.vehicle_id IS NOT NULL AND a.is_active),
              '{}') as vehicle_ids`)
    )
  return rows.map((r: any) => {
    const circle = r.shape_type === 'circle'
    return {
      id: r.id,
      organizationId: r.organization_id,
      organization: { id: r.organization_id, name: r.org_name, code: r.org_code },
      name: r.name,
      description: r.description,
      shape: circle ? 'circle' : 'polygon',
      center: circle && r.center_lat !== null ? { lat: r.center_lat, lng: r.center_lng } : null,
      radiusM: circle && r.radius_m !== null ? Number(r.radius_m) : null,
      points: circle ? [] : ring(r.geojson),
      kind: r.kind,
      alertOnEntry: r.alert_on_entry,
      alertOnExit: r.alert_on_exit,
      vehicleIds: r.vehicle_ids ?? [],
      color: r.color ?? DEFAULT_COLOR,
      active: r.is_active,
      updatedAt: new Date(r.updated_at).toISOString(),
    } satisfies GeofenceDto
  })
}

export async function findGeofenceDto(id: string): Promise<GeofenceDto | null> {
  const row = await db.from('geofences').where('id', id).whereNull('deleted_at').first()
  if (!row) return null
  const all = await listGeofences(row.organization_id)
  return all.find((g) => g.id === id) ?? null
}

/** Zone vivante (sans géométrie) : appartenance et réglages d'alerte. */
export async function findGeofence(id: string): Promise<{
  id: string
  organizationId: string
  name: string
  active: boolean
  alertOnEntry: boolean
  alertOnExit: boolean
} | null> {
  const r = await db
    .from('geofences')
    .where('id', id)
    .whereNull('deleted_at')
    .select('id', 'organization_id', 'name', 'is_active', 'alert_on_entry', 'alert_on_exit')
    .first()
  return r
    ? {
        id: r.id,
        organizationId: r.organization_id,
        name: r.name,
        active: r.is_active,
        alertOnEntry: r.alert_on_entry,
        alertOnExit: r.alert_on_exit,
      }
    : null
}

/** Nom déjà pris par une autre zone vivante de l'organisation ? */
export async function geofenceNameTaken(organizationId: string, name: string, exceptId?: string) {
  const q = db
    .from('geofences')
    .where('organization_id', organizationId)
    .whereRaw('lower(name) = lower(?)', [name.trim()])
    .whereNull('deleted_at')
  if (exceptId) q.whereNot('id', exceptId)
  return Boolean(await q.first())
}

function geometrySql(input: GeofenceInput): { sql: string; bindings: unknown[] } {
  if (input.shape === 'circle') {
    const { lat, lng } = input.center!
    return {
      sql: `ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)::geometry)::geography`,
      bindings: [lng, lat, input.radiusM],
    }
  }
  const pts = [...input.points, input.points[0]]
  const wkt = `MULTIPOLYGON(((${pts.map((p) => `${p.lng} ${p.lat}`).join(', ')})))`
  return { sql: `ST_GeogFromText(?)`, bindings: [`SRID=4326;${wkt}`] }
}

/** Crée ou remplace une zone et ses véhicules surveillés, en une transaction. */
export async function saveGeofence(
  input: GeofenceInput,
  actorId: string | null,
  id?: string
): Promise<string> {
  return db.transaction(async (trx) => {
    const geom = geometrySql(input)
    const center =
      input.shape === 'circle'
        ? db.raw('ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography', [
            input.center!.lng,
            input.center!.lat,
          ])
        : null
    const values = {
      name: input.name.trim(),
      description: input.description,
      kind: input.kind,
      shape_type: input.shape,
      geom: db.raw(geom.sql, geom.bindings),
      center,
      radius_m: input.shape === 'circle' ? input.radiusM : null,
      color: input.color,
      alert_on_entry: input.alertOnEntry,
      alert_on_exit: input.alertOnExit,
      is_active: input.active,
    }
    let zoneId = id
    if (zoneId) {
      await trx.from('geofences').where('id', zoneId).update(values)
    } else {
      const [row] = await trx
        .table('geofences')
        .insert({ ...values, organization_id: input.organizationId, created_by: actorId })
        .returning('id')
      zoneId = row.id as string
    }
    await trx.rawQuery('UPDATE geofences SET area_m2 = ST_Area(geom) WHERE id = ?', [zoneId])
    await trx.from('geofence_assignments').where('geofence_id', zoneId).delete()
    if (input.vehicleIds.length) {
      await trx.table('geofence_assignments').multiInsert(
        input.vehicleIds.map((vehicleId) => ({
          geofence_id: zoneId,
          vehicle_id: vehicleId,
          notify_on_enter: input.alertOnEntry,
          notify_on_exit: input.alertOnExit,
        }))
      )
    }
    return zoneId!
  })
}

// =========================================================================
//  Politiques de vitesse
// =========================================================================

export interface SpeedPolicyDto {
  id: string
  organizationId: string
  organization: OrganizationRef
  name: string
  scope: SpeedScope
  zoneId: string | null
  vehicleIds: string[]
  limitKph: number
  toleranceKph: number
  minDurationSeconds: number
  severity: Severity
  limiterEnabled: boolean
  active: boolean
  updatedAt: string
}

export type SpeedPolicyInput = Omit<SpeedPolicyDto, 'id' | 'organization' | 'updatedAt'>

export async function listSpeedPolicies(organizationId: string | null): Promise<SpeedPolicyDto[]> {
  const rows = await db
    .from('speed_policies as p')
    .join('organizations as o', 'o.id', 'p.organization_id')
    .whereNull('p.deleted_at')
    .if(organizationId !== null, (q) => q.where('p.organization_id', organizationId!))
    .orderBy('p.name')
    .select(
      'p.*',
      'o.name as org_name',
      'o.code as org_code',
      db.raw(`COALESCE((SELECT array_agg(v.vehicle_id) FROM speed_policy_vehicles v
                WHERE v.speed_policy_id = p.id), '{}') as vehicle_ids`)
    )
  return rows.map((r: any) => ({
    id: r.id,
    organizationId: r.organization_id,
    organization: { id: r.organization_id, name: r.org_name, code: r.org_code },
    name: r.name,
    scope: r.scope,
    zoneId: r.geofence_id,
    vehicleIds: r.vehicle_ids ?? [],
    limitKph: r.limit_kph,
    toleranceKph: r.tolerance_kph,
    minDurationSeconds: r.min_duration_seconds,
    severity: r.severity,
    limiterEnabled: r.limiter_enabled,
    active: r.is_active,
    updatedAt: new Date(r.updated_at).toISOString(),
  }))
}

export async function findSpeedPolicyDto(id: string): Promise<SpeedPolicyDto | null> {
  const row = await db.from('speed_policies').where('id', id).whereNull('deleted_at').first()
  if (!row) return null
  const all = await listSpeedPolicies(row.organization_id)
  return all.find((p) => p.id === id) ?? null
}

export async function speedPolicyNameTaken(
  organizationId: string,
  name: string,
  exceptId?: string
) {
  const q = db
    .from('speed_policies')
    .where('organization_id', organizationId)
    .whereRaw('lower(name) = lower(?)', [name.trim()])
    .whereNull('deleted_at')
  if (exceptId) q.whereNot('id', exceptId)
  return Boolean(await q.first())
}

export async function saveSpeedPolicy(
  input: SpeedPolicyInput,
  actorId: string | null,
  id?: string
): Promise<string> {
  return db.transaction(async (trx) => {
    const values = {
      name: input.name.trim(),
      scope: input.scope,
      geofence_id: input.scope === 'zone' ? input.zoneId : null,
      limit_kph: input.limitKph,
      tolerance_kph: input.toleranceKph,
      min_duration_seconds: input.minDurationSeconds,
      severity: input.severity,
      limiter_enabled: input.limiterEnabled,
      is_active: input.active,
    }
    let policyId = id
    if (policyId) {
      await trx.from('speed_policies').where('id', policyId).update(values)
    } else {
      const [row] = await trx
        .table('speed_policies')
        .insert({ ...values, organization_id: input.organizationId, created_by: actorId })
        .returning('id')
      policyId = row.id as string
    }
    await trx.from('speed_policy_vehicles').where('speed_policy_id', policyId).delete()
    const vehicleIds = input.scope === 'vehicle' ? [...new Set(input.vehicleIds)] : []
    if (vehicleIds.length) {
      await trx
        .table('speed_policy_vehicles')
        .multiInsert(vehicleIds.map((v) => ({ speed_policy_id: policyId, vehicle_id: v })))
    }
    return policyId!
  })
}

// =========================================================================
//  Règles
// =========================================================================

export interface RuleConditionDto {
  id: string
  field: RuleField
  operator: RuleOperator
  value: string
  values?: string[]
  valueLabel?: string
  valueLabels?: string[]
  target?: ConditionTarget
}

export interface RuleActionDto {
  id: string
  type: RuleActionType
  value: string
  channels?: string[]
}

export interface RuleDto {
  id: string
  organizationId: string
  organization: OrganizationRef
  name: string
  description: string | null
  trigger: EventType
  conditions: RuleConditionDto[]
  actions: RuleActionDto[]
  severity: Severity
  active: boolean
  triggerCount: number
  lastTriggeredAt: string | null
  updatedAt: string
}

export interface RuleInput {
  organizationId: string
  name: string
  description: string | null
  trigger: EventType
  conditions: RuleConditionDto[]
  actions: Omit<RuleActionDto, 'id'>[]
  severity: Severity
  active: boolean
}

export async function listRules(organizationId: string | null): Promise<RuleDto[]> {
  const rows = await db
    .from('policies as p')
    .join('organizations as o', 'o.id', 'p.organization_id')
    .whereNull('p.deleted_at')
    .if(organizationId !== null, (q) => q.where('p.organization_id', organizationId!))
    .orderBy('p.name')
    .select(
      'p.id',
      'p.organization_id',
      'p.name',
      'p.description',
      'p.trigger_type',
      'p.conditions',
      'p.severity',
      'p.is_active',
      'p.updated_at',
      'o.name as org_name',
      'o.code as org_code',
      db.raw(`(SELECT count(*)::int FROM policy_executions e
                WHERE e.policy_id = p.id AND e.status IN ('succeeded','partial')) as trigger_count`),
      db.raw(`(SELECT max(e.started_at) FROM policy_executions e
                WHERE e.policy_id = p.id AND e.status IN ('succeeded','partial')) as last_triggered_at`)
    )
  const ids = rows.map((r: any) => r.id)
  const actions = ids.length
    ? await db
        .from('policy_actions')
        .whereIn('policy_id', ids)
        .orderBy('order_index')
        .select('id', 'policy_id', 'action_type', 'config')
    : []
  const byRule = new Map<string, RuleActionDto[]>()
  for (const a of actions) {
    const list = byRule.get(a.policy_id) ?? []
    list.push({
      id: a.id,
      type: a.action_type,
      value: a.config?.value ?? '',
      ...(a.config?.channels ? { channels: a.config.channels } : {}),
    })
    byRule.set(a.policy_id, list)
  }
  return rows.map((r: any) => ({
    id: r.id,
    organizationId: r.organization_id,
    organization: { id: r.organization_id, name: r.org_name, code: r.org_code },
    name: r.name,
    description: r.description,
    trigger: r.trigger_type,
    conditions: Array.isArray(r.conditions) ? r.conditions : [],
    actions: byRule.get(r.id) ?? [],
    severity: r.severity,
    active: r.is_active,
    triggerCount: r.trigger_count ?? 0,
    lastTriggeredAt: r.last_triggered_at ? new Date(r.last_triggered_at).toISOString() : null,
    updatedAt: new Date(r.updated_at).toISOString(),
  }))
}

export async function findRuleDto(id: string): Promise<RuleDto | null> {
  const row = await db.from('policies').where('id', id).whereNull('deleted_at').first()
  if (!row) return null
  const all = await listRules(row.organization_id)
  return all.find((r) => r.id === id) ?? null
}

export async function ruleNameTaken(organizationId: string, name: string, exceptId?: string) {
  const q = db
    .from('policies')
    .where('organization_id', organizationId)
    .whereRaw('lower(name) = lower(?)', [name.trim()])
    .whereNull('deleted_at')
  if (exceptId) q.whereNot('id', exceptId)
  return Boolean(await q.first())
}

/** Cibles d'index dérivées des conditions (`policy_targets`). */
function targetsOf(conditions: readonly RuleConditionDto[]) {
  const seen = new Set<string>()
  const rows: { scope: string; vehicle_id: string | null; vehicle_group_id: string | null }[] = []
  for (const c of conditions) {
    const t = c.target ?? { type: 'all' as const }
    const key = t.type === 'all' ? 'all' : `${t.type}:${t.id}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(
      t.type === 'vehicle'
        ? { scope: 'vehicle', vehicle_id: t.id, vehicle_group_id: null }
        : t.type === 'fleet'
          ? { scope: 'group', vehicle_id: null, vehicle_group_id: t.id }
          : { scope: 'all', vehicle_id: null, vehicle_group_id: null }
    )
  }
  return rows.length ? rows : [{ scope: 'all', vehicle_id: null, vehicle_group_id: null }]
}

/** Crée ou remplace une règle (version + 1), ses actions et ses cibles. */
export async function saveRule(input: RuleInput, actorId: string | null, id?: string) {
  return db.transaction(async (trx) => {
    const values = {
      name: input.name.trim(),
      description: input.description,
      trigger_type: input.trigger,
      conditions: JSON.stringify(input.conditions),
      severity: input.severity,
      is_active: input.active,
    }
    let ruleId = id
    if (ruleId) {
      await trx
        .from('policies')
        .where('id', ruleId)
        .update({ ...values, version: db.raw('version + 1') })
    } else {
      const [row] = await trx
        .table('policies')
        .insert({
          ...values,
          organization_id: input.organizationId,
          created_by: actorId,
          requires_human_validation: false,
        })
        .returning('id')
      ruleId = row.id as string
    }
    await replaceChildren(trx, ruleId!, input)
    return ruleId!
  })
}

async function replaceChildren(trx: Executor, ruleId: string, input: RuleInput) {
  await trx.from('policy_actions').where('policy_id', ruleId).delete()
  await trx.table('policy_actions').multiInsert(
    input.actions.map((a, i) => ({
      policy_id: ruleId,
      action_type: a.type,
      config: JSON.stringify({ value: a.value, ...(a.channels ? { channels: a.channels } : {}) }),
      order_index: i,
    }))
  )
  await trx.from('policy_targets').where('policy_id', ruleId).delete()
  await trx
    .table('policy_targets')
    .multiInsert(targetsOf(input.conditions).map((t) => ({ ...t, policy_id: ruleId })))
}

// =========================================================================
//  Activation et références
// =========================================================================

const TABLES = { geofence: 'geofences', speed: 'speed_policies', rule: 'policies' } as const
export type RuleEngineKind = keyof typeof TABLES

/** Organisation d'une ressource vivante, ou `null`. */
export async function ownerOf(kind: RuleEngineKind, id: string): Promise<string | null> {
  const r = await db
    .from(TABLES[kind])
    .where('id', id)
    .whereNull('deleted_at')
    .select('organization_id')
    .first()
  return r?.organization_id ?? null
}

export async function setActive(kind: RuleEngineKind, id: string, active: boolean) {
  await db.from(TABLES[kind]).where('id', id).update({ is_active: active })
}

export async function organizationExists(id: string): Promise<boolean> {
  return Boolean(await db.from('organizations').where('id', id).whereNull('deleted_at').first())
}

/** Noms des références d'une organisation, pour vérifier et étiqueter les conditions. */
export async function referencesOf(organizationId: string) {
  const [policies, zones, schedules, vehicles, fleets] = await Promise.all([
    db
      .from('speed_policies')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'name', 'is_active'),
    db
      .from('geofences')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'name', 'is_active', 'alert_on_entry', 'alert_on_exit'),
    db
      .from('usage_schedules')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'name', 'is_active'),
    db
      .from('vehicles')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'registration', 'status'),
    db
      .from('vehicle_groups')
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'name'),
  ])
  return {
    speedPolicies: new Map(policies.map((p: any) => [p.id, p])),
    zones: new Map(zones.map((z: any) => [z.id, z])),
    schedules: new Map(schedules.map((s: any) => [s.id, s])),
    vehicles: new Map(vehicles.map((v: any) => [v.id, v])),
    fleets: new Map(fleets.map((f: any) => [f.id, f])),
  }
}
