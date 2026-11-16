/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class UserSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'deletedAt',
    'email',
    'failedAttempts',
    'fullName',
    'id',
    'lastLoginAt',
    'lastLoginIp',
    'locale',
    'lockedUntil',
    'organizationId',
    'passwordChangedAt',
    'passwordHash',
    'phone',
    'roleId',
    'status',
    'timezone',
    'updatedAt',
  ] as const
  $columns = UserSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare email: any
  @column()
  declare failedAttempts: number
  @column()
  declare fullName: string
  @column({ isPrimary: true })
  declare id: string
  @column.dateTime()
  declare lastLoginAt: DateTime | null
  @column()
  declare lastLoginIp: string | null
  @column()
  declare locale: string
  @column.dateTime()
  declare lockedUntil: DateTime | null
  @column()
  declare organizationId: string
  @column.dateTime()
  declare passwordChangedAt: DateTime | null
  @column()
  declare passwordHash: string
  @column()
  declare phone: string | null
  @column()
  declare roleId: string
  @column()
  declare status: string
  @column()
  declare timezone: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
