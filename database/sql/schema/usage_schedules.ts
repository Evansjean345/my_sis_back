/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class UsageScheduleSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'deletedAt',
    'description',
    'id',
    'isActive',
    'name',
    'organizationId',
    'timezone',
    'updatedAt',
  ] as const
  $columns = UsageScheduleSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare description: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare name: string
  @column()
  declare organizationId: string
  @column()
  declare timezone: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
