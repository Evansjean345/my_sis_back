/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DriverGroupMemberSchema extends BaseModel {
  static $columns = ['addedAt', 'driverGroupId', 'driverId'] as const
  $columns = DriverGroupMemberSchema.$columns
  @column.dateTime()
  declare addedAt: DateTime
  @column({ isPrimary: true })
  declare driverGroupId: string
  @column()
  declare driverId: string
}
