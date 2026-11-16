/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class OrganizationSchema extends BaseModel {
  static $columns = [
    'code',
    'contactEmail',
    'contactPhone',
    'countryCode',
    'createdAt',
    'deletedAt',
    'id',
    'isActive',
    'name',
    'settings',
    'timezone',
    'updatedAt',
  ] as const
  $columns = OrganizationSchema.$columns
  @column()
  declare code: string
  @column()
  declare contactEmail: any | null
  @column()
  declare contactPhone: string | null
  @column()
  declare countryCode: string
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare name: string
  @column()
  declare settings: any
  @column()
  declare timezone: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
