/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class ApiClientSchema extends BaseModel {
  static $columns = [
    'allowedIps',
    'createdAt',
    'createdBy',
    'description',
    'expiresAt',
    'id',
    'isActive',
    'keyHash',
    'keyPrefix',
    'lastUsedAt',
    'name',
    'organizationId',
    'rateLimitPerMinute',
    'revokedAt',
    'scopes',
    'updatedAt',
  ] as const
  $columns = ApiClientSchema.$columns
  @column()
  declare allowedIps: any | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare createdBy: string | null
  @column()
  declare description: string | null
  @column.dateTime()
  declare expiresAt: DateTime | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare keyHash: string
  @column()
  declare keyPrefix: string
  @column.dateTime()
  declare lastUsedAt: DateTime | null
  @column()
  declare name: string
  @column()
  declare organizationId: string
  @column()
  declare rateLimitPerMinute: number
  @column.dateTime()
  declare revokedAt: DateTime | null
  @column()
  declare scopes: any
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
