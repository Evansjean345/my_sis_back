/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DriverGroupSchema extends BaseModel {
  static $columns = [
    'color',
    'createdAt',
    'deletedAt',
    'description',
    'id',
    'name',
    'organizationId',
    'updatedAt',
  ] as const
  $columns = DriverGroupSchema.$columns
  @column()
  declare color: string | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare description: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare name: string
  @column()
  declare organizationId: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
