/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class VehicleLastPositionSchema extends BaseModel {
  static $columns = [
    'address',
    'batteryPct',
    'connectionState',
    'deviceId',
    'externalVoltageV',
    'gsmSignal',
    'headingDeg',
    'ignition',
    'location',
    'movement',
    'organizationId',
    'receivedAt',
    'recordedAt',
    'speedKph',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = VehicleLastPositionSchema.$columns
  @column()
  declare address: string | null
  @column()
  declare batteryPct: string | null
  @column()
  declare connectionState: string
  @column()
  declare deviceId: string | null
  @column()
  declare externalVoltageV: string | null
  @column()
  declare gsmSignal: number | null
  @column()
  declare headingDeg: string | null
  @column()
  declare ignition: boolean | null
  @column()
  declare location: any
  @column()
  declare movement: boolean | null
  @column()
  declare organizationId: string
  @column.dateTime()
  declare receivedAt: DateTime
  @column.dateTime()
  declare recordedAt: DateTime
  @column()
  declare speedKph: string | null
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column({ isPrimary: true })
  declare vehicleId: string
}
