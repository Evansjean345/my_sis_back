/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DriverSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'deletedAt',
    'email',
    'employeeCode',
    'firstName',
    'fullName',
    'id',
    'lastName',
    'licenseCategories',
    'licenseExpiresOn',
    'licenseNumber',
    'notes',
    'organizationId',
    'phone',
    'status',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = DriverSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare email: any | null
  @column()
  declare employeeCode: string | null
  @column()
  declare firstName: string
  @column()
  declare fullName: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare lastName: string
  @column()
  declare licenseCategories: any
  @column.date()
  declare licenseExpiresOn: DateTime | null
  @column()
  declare licenseNumber: string | null
  @column()
  declare notes: string | null
  @column()
  declare organizationId: string | null
  @column()
  declare phone: string | null
  @column()
  declare status: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleId: string | null
}
