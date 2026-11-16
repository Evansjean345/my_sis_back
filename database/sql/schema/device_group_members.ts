/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DeviceGroupMemberSchema extends BaseModel {
  static $columns = ['addedAt', 'deviceGroupId', 'deviceId'] as const
  $columns = DeviceGroupMemberSchema.$columns
  @column.dateTime()
  declare addedAt: DateTime
  @column({ isPrimary: true })
  declare deviceGroupId: string
  @column()
  declare deviceId: string
}
