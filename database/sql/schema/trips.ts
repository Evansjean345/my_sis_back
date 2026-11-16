/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class TripSchema extends BaseModel {
  static $columns = [
    'avgSpeedKph',
    'closeReason',
    'createdAt',
    'deviceId',
    'distanceM',
    'durationS',
    'endAddress',
    'endLocation',
    'endedAt',
    'id',
    'idleDurationS',
    'lastPointAt',
    'maxSpeedKph',
    'organizationId',
    'path',
    'positionsCount',
    'startAddress',
    'startLocation',
    'startedAt',
    'status',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = TripSchema.$columns
  @column()
  declare avgSpeedKph: string | null
  @column()
  declare closeReason: string | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare deviceId: string | null
  @column()
  declare distanceM: string
  @column()
  declare durationS: number | null
  @column()
  declare endAddress: string | null
  @column()
  declare endLocation: any | null
  @column.dateTime()
  declare endedAt: DateTime | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare idleDurationS: number
  @column.dateTime()
  declare lastPointAt: DateTime
  @column()
  declare maxSpeedKph: string | null
  @column()
  declare organizationId: string
  @column()
  declare path: any | null
  @column()
  declare positionsCount: number
  @column()
  declare startAddress: string | null
  @column()
  declare startLocation: any | null
  @column.dateTime()
  declare startedAt: DateTime
  @column()
  declare status: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleId: string
}
