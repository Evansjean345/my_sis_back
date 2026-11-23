import vine from '@vinejs/vine'
import {
  EVENT_TYPES,
  RULE_ACTION_TYPES,
  RULE_FIELDS,
  RULE_OPERATORS,
  SEVERITIES,
  SPEED_SCOPES,
} from '#domain/policy/rule_policy'

/**
 * Schémas du moteur de règles (migration 032) — mêmes charges utiles que le
 * tableau de bord. Côté client, `organizationId` est ignoré : l'organisation
 * est celle du compte connecté. Cohérence et appartenance : contrôleurs.
 */

const latLng = () =>
  vine.object({
    lat: vine.number().min(-90).max(90),
    lng: vine.number().min(-180).max(180),
  })
const uuids = () => vine.array(vine.string().uuid()).maxLength(500)
const name = () => vine.string().trim().minLength(1).maxLength(120)
const description = () => vine.string().trim().maxLength(1000).nullable().optional()

/** POST / PATCH [/admin]/geofences */
export const geofenceValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid().optional(),
    name: name(),
    description: description(),
    shape: vine.enum(['circle', 'polygon'] as const),
    center: latLng().nullable().optional(),
    radiusM: vine.number().min(0).max(100_000).nullable().optional(),
    points: vine.array(latLng()).maxLength(500).optional(),
    kind: vine.enum(['authorized', 'forbidden'] as const),
    alertOnEntry: vine.boolean(),
    alertOnExit: vine.boolean(),
    vehicleIds: uuids().optional(),
    color: vine
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    active: vine.boolean().optional(),
  })
)

/** POST / PATCH [/admin]/speed-policies */
export const speedPolicyValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid().optional(),
    name: name(),
    scope: vine.enum(SPEED_SCOPES),
    zoneId: vine.string().uuid().nullable().optional(),
    vehicleIds: uuids().optional(),
    limitKph: vine.number().withoutDecimals().min(5).max(200),
    toleranceKph: vine.number().withoutDecimals().min(0).max(50).optional(),
    minDurationSeconds: vine.number().withoutDecimals().min(0).max(3600).optional(),
    severity: vine.enum(SEVERITIES),
    limiterEnabled: vine.boolean().optional(),
    active: vine.boolean().optional(),
  })
)

const target = vine.object({
  type: vine.enum(['all', 'vehicle', 'fleet'] as const),
  id: vine.string().uuid().optional(),
  label: vine.string().optional(),
})

/** POST / PATCH [/admin]/rules */
export const ruleValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid().optional(),
    name: name(),
    description: description(),
    trigger: vine.enum(EVENT_TYPES),
    conditions: vine
      .array(
        vine.object({
          id: vine.string().maxLength(64).optional(),
          field: vine.enum(RULE_FIELDS),
          operator: vine.enum(RULE_OPERATORS),
          value: vine.string().trim().maxLength(200).optional(),
          values: vine.array(vine.string().uuid()).maxLength(50).optional(),
          valueLabel: vine.string().optional(),
          valueLabels: vine.array(vine.string()).optional(),
          target: target.optional(),
        })
      )
      .maxLength(20),
    actions: vine
      .array(
        vine.object({
          id: vine.string().maxLength(64).optional(),
          type: vine.enum(RULE_ACTION_TYPES),
          value: vine.string().trim().maxLength(200).optional(),
          channels: vine.array(vine.enum(['sms', 'email', 'push'] as const)).optional(),
        })
      )
      .maxLength(10),
    severity: vine.enum(SEVERITIES),
    active: vine.boolean().optional(),
  })
)

/** POST [/admin]/{geofences|speed-policies|rules}/:id/toggle */
export const toggleValidator = vine.compile(vine.object({ active: vine.boolean() }))

/** GET /admin/{geofences|speed-policies|rules}?organizationId= */
export const ruleEngineListValidator = vine.compile(
  vine.object({ organizationId: vine.string().uuid().optional() })
)
