/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class VehicleScheduleStateSchema extends BaseModel {
  static $columns = [
    'attempts',
    'cause',
    'desiredState',
    'evaluatedAt',
    'lastCommandId',
    'lastErrorCode',
    'lastErrorMessage',
    'lastOutcome',
    'nextAttemptAt',
    'organizationId',
    'pendingAction',
    'pendingSince',
    'updatedAt',
    'usageScheduleId',
    'vehicleId',
  ] as const
  $columns = VehicleScheduleStateSchema.$columns
  @column()
  declare attempts: number
  @column()
  declare cause: string
  @column()
  declare desiredState: string
  @column.dateTime()
  declare evaluatedAt: DateTime
  @column()
  declare lastCommandId: string | null
  @column()
  declare lastErrorCode: string | null
  @column()
  declare lastErrorMessage: string | null
  @column()
  declare lastOutcome: string | null
  @column.dateTime()
  declare nextAttemptAt: DateTime | null
  @column()
  declare organizationId: string
  @column()
  declare pendingAction: string | null
  @column.dateTime()
  declare pendingSince: DateTime | null
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare usageScheduleId: string | null
  @column({ isPrimary: true })
  declare vehicleId: string
}
