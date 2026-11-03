/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class VehicleGroupMemberSchema extends BaseModel {
  static $columns = ['addedAt', 'vehicleGroupId', 'vehicleId'] as const
  $columns = VehicleGroupMemberSchema.$columns
  @column.dateTime()
  declare addedAt: DateTime
  @column({ isPrimary: true })
  declare vehicleGroupId: string
  @column()
  declare vehicleId: string
}
