/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class VehicleScheduleGroupSchema extends BaseModel {
  static $columns = ['createdAt', 'mode', 'usageScheduleId', 'vehicleGroupId'] as const
  $columns = VehicleScheduleGroupSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare mode: string
  @column()
  declare usageScheduleId: string
  @column({ isPrimary: true })
  declare vehicleGroupId: string
}
