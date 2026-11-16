/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class UserNotificationPreferenceSchema extends BaseModel {
  static $columns = [
    'channel',
    'isEnabled',
    'minSeverity',
    'quietFrom',
    'quietTo',
    'updatedAt',
    'userId',
  ] as const
  $columns = UserNotificationPreferenceSchema.$columns
  @column()
  declare channel: string
  @column()
  declare isEnabled: boolean
  @column()
  declare minSeverity: string
  @column()
  declare quietFrom: string | null
  @column()
  declare quietTo: string | null
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column({ isPrimary: true })
  declare userId: string
}
