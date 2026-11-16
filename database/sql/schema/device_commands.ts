/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DeviceCommandSchema extends BaseModel {
  static $columns = [
    'acknowledgedAt',
    'alertId',
    'attempts',
    'commandType',
    'createdAt',
    'deviceId',
    'errorMessage',
    'expiresAt',
    'failedAt',
    'id',
    'ignitionAtRequest',
    'incidentId',
    'locationAtRequest',
    'organizationId',
    'origin',
    'policyId',
    'provider',
    'providerCommandId',
    'queuedAt',
    'reason',
    'requestedAt',
    'requestedBy',
    'safetyContext',
    'safetySpeedLimitKph',
    'sentAt',
    'speedAtRequestKph',
    'status',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = DeviceCommandSchema.$columns
  @column.dateTime()
  declare acknowledgedAt: DateTime | null
  @column()
  declare alertId: string | null
  @column()
  declare attempts: number
  @column()
  declare commandType: string
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare deviceId: string
  @column()
  declare errorMessage: string | null
  @column.dateTime()
  declare expiresAt: DateTime
  @column.dateTime()
  declare failedAt: DateTime | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare ignitionAtRequest: boolean | null
  @column()
  declare incidentId: string | null
  @column()
  declare locationAtRequest: any | null
  @column()
  declare organizationId: string
  @column()
  declare origin: string
  @column()
  declare policyId: string | null
  @column()
  declare provider: string
  @column()
  declare providerCommandId: string | null
  @column.dateTime()
  declare queuedAt: DateTime | null
  @column()
  declare reason: string
  @column.dateTime()
  declare requestedAt: DateTime
  @column()
  declare requestedBy: string | null
  @column()
  declare safetyContext: any
  @column()
  declare safetySpeedLimitKph: string
  @column.dateTime()
  declare sentAt: DateTime | null
  @column()
  declare speedAtRequestKph: string | null
  @column()
  declare status: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleId: string | null
}
