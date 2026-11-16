/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class PositionSchema extends BaseModel {
  static $columns = [
    'altitudeM',
    'batteryPct',
    'deviceId',
    'externalVoltageV',
    'gsmSignal',
    'hdop',
    'headingDeg',
    'id',
    'ignition',
    'invalidReason',
    'isBacklog',
    'isValid',
    'location',
    'movement',
    'organizationId',
    'raw',
    'receivedAt',
    'recordedAt',
    'satellites',
    'source',
    'speedKph',
    'tripId',
    'vehicleId',
  ] as const
  $columns = PositionSchema.$columns
  @column()
  declare altitudeM: string | null
  @column()
  declare batteryPct: string | null
  @column()
  declare deviceId: string
  @column()
  declare externalVoltageV: string | null
  @column()
  declare gsmSignal: number | null
  @column()
  declare hdop: string | null
  @column()
  declare headingDeg: string | null
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare ignition: boolean | null
  @column()
  declare invalidReason: string | null
  @column()
  declare isBacklog: boolean
  @column()
  declare isValid: boolean
  @column()
  declare location: any
  @column()
  declare movement: boolean | null
  @column()
  declare organizationId: string
  @column()
  declare raw: any | null
  @column.dateTime()
  declare receivedAt: DateTime
  @column.dateTime()
  declare recordedAt: DateTime
  @column()
  declare satellites: number | null
  @column()
  declare source: string
  @column()
  declare speedKph: string | null
  @column()
  declare tripId: string | null
  @column()
  declare vehicleId: string | null
}
