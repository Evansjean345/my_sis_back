import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'

/**
 * =========================================================================
 *  SCHÉMAS DES INDICATEURS CLIENT (tableau de bord d'une organisation)
 * =========================================================================
 *
 * Mêmes filtres que leurs équivalents `/admin/*`, SANS `organizationId` :
 * côté client, l'organisation est TOUJOURS celle de l'acteur. Accepter le
 * paramètre pour l'ignorer ensuite laisserait croire qu'il filtre.
 */

const VEHICLE_STATUS = ['draft', 'active', 'maintenance', 'inactive', 'archived'] as const
const COMMAND_STATUS = [
  'pending_validation',
  'approved',
  'rejected',
  'queued',
  'sent',
  'acknowledged',
  'failed',
  'expired',
  'cancelled',
] as const

const isoInstant = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (Number.isNaN(Date.parse(value))) {
    field.report('Le champ {{ field }} doit être une date ISO 8601', 'isoInstant', field)
  }
})

/** GET /stats/activity — fenêtre des courbes (90 jours max : `positions` est partitionnée). */
export const activityWindowValidator = vine.compile(
  vine.object({
    days: vine.number().min(7).max(90).optional(),
  })
)

/** GET /commands — journal des commandes de l'organisation. */
export const listCommandsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    deviceId: vine.string().uuid().optional(),
    vehicleId: vine.string().uuid().optional(),
    status: vine.enum(COMMAND_STATUS).optional(),
    commandType: vine.string().trim().maxLength(40).optional(),
    from: vine.string().trim().maxLength(40).use(isoInstant()).optional(),
    to: vine.string().trim().maxLength(40).use(isoInstant()).optional(),
  })
)

/**
 * GET /fleet/live — la flotte sur la carte, en UNE requête.
 *
 * `status` absent = tous les véhicules non archivés. `vehicleGroupId`
 * restreint à un groupe de l'organisation (un groupe d'un autre client
 * donne une carte vide, pas une fuite : le filtre croise l'organisation).
 */
export const liveFleetValidator = vine.compile(
  vine.object({
    status: vine.enum(VEHICLE_STATUS).optional(),
    vehicleGroupId: vine.string().uuid().optional(),
  })
)
