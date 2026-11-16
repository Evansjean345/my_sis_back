/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class EventSchema extends BaseModel {
  static $columns = [
    'actualValue',
    'createdAt',
    'dedupKey',
    'deviceId',
    'eventType',
    'geofenceId',
    'id',
    'location',
    'occurredAt',
    'organizationId',
    'payload',
    'positionId',
    'receivedAt',
    'severity',
    'speedKph',
    'thresholdValue',
    'tripId',
    'vehicleId',
  ] as const
  $columns = EventSchema.$columns
  @column()
  declare actualValue: string | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare dedupKey: string
  @column()
  declare deviceId: string | null
  @column()
  declare eventType: string
  @column()
  declare geofenceId: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare location: any | null
  @column.dateTime()
  declare occurredAt: DateTime
  @column()
  declare organizationId: string
  @column()
  declare payload: any
  @column()
  declare positionId: bigint | number | null
  @column.dateTime()
  declare receivedAt: DateTime
  @column()
  declare severity: string
  @column()
  declare speedKph: string | null
  @column()
  declare thresholdValue: string | null
  @column()
  declare tripId: string | null
  @column()
  declare vehicleId: string | null
}
