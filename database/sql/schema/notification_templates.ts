/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class NotificationTemplateSchema extends BaseModel {
  static $columns = [
    'body',
    'channel',
    'code',
    'createdAt',
    'id',
    'isActive',
    'locale',
    'organizationId',
    'subject',
    'updatedAt',
  ] as const
  $columns = NotificationTemplateSchema.$columns
  @column()
  declare body: string
  @column()
  declare channel: string
  @column()
  declare code: string
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare locale: string
  @column()
  declare organizationId: string | null
  @column()
  declare subject: string | null
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
