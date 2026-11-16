/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class AlertSchema extends BaseModel {
  static $columns = [
    'acknowledgedAt',
    'acknowledgedBy',
    'alertType',
    'context',
    'createdAt',
    'eventId',
    'id',
    'incidentId',
    'lastOccurredAt',
    'location',
    'message',
    'occurrences',
    'organizationId',
    'policyId',
    'resolutionNote',
    'resolvedAt',
    'resolvedBy',
    'severity',
    'status',
    'title',
    'triggeredAt',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = AlertSchema.$columns
  @column.dateTime()
  declare acknowledgedAt: DateTime | null
  @column()
  declare acknowledgedBy: string | null
  @column()
  declare alertType: string
  @column()
  declare context: any
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare eventId: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare incidentId: string | null
  @column.dateTime()
  declare lastOccurredAt: DateTime | null
  @column()
  declare location: any | null
  @column()
  declare message: string | null
  @column()
  declare occurrences: number
  @column()
  declare organizationId: string
  @column()
  declare policyId: string | null
  @column()
  declare resolutionNote: string | null
  @column.dateTime()
  declare resolvedAt: DateTime | null
  @column()
  declare resolvedBy: string | null
  @column()
  declare severity: string
  @column()
  declare status: string
  @column()
  declare title: string
  @column.dateTime()
  declare triggeredAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleId: string | null
}
