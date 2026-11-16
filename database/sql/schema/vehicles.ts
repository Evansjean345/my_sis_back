/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class VehicleSchema extends BaseModel {
  static $columns = [
    'brand',
    'color',
    'createdAt',
    'deletedAt',
    'id',
    'immobilizationEnabled',
    'label',
    'metadata',
    'model',
    'notes',
    'odometerKm',
    'organizationId',
    'registration',
    'speedLimitKph',
    'status',
    'updatedAt',
    'vehicleType',
    'vin',
    'year',
  ] as const
  $columns = VehicleSchema.$columns
  @column()
  declare brand: string | null
  @column()
  declare color: string | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare immobilizationEnabled: boolean
  @column()
  declare label: string | null
  @column()
  declare metadata: any
  @column()
  declare model: string | null
  @column()
  declare notes: string | null
  @column()
  declare odometerKm: string
  @column()
  declare organizationId: string
  @column()
  declare registration: any
  @column()
  declare speedLimitKph: string | null
  @column()
  declare status: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleType: string
  @column()
  declare vin: string | null
  @column()
  declare year: number | null
}
