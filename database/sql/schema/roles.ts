/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class RoleSchema extends BaseModel {
  static $columns = [
    'code',
    'createdAt',
    'description',
    'id',
    'isSystem',
    'name',
    'organizationId',
    'permissions',
    'updatedAt',
  ] as const
  $columns = RoleSchema.$columns
  @column()
  declare code: string
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare description: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isSystem: boolean
  @column()
  declare name: string
  @column()
  declare organizationId: string | null
  @column()
  declare permissions: any
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
