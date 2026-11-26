/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class VehicleScheduleSchema extends BaseModel {
  static $columns = ['createdAt', 'usageScheduleId', 'vehicleId'] as const
  $columns = VehicleScheduleSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare usageScheduleId: string
  @column({ isPrimary: true })
  declare vehicleId: string
}
