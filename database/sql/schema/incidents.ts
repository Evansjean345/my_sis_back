/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class IncidentSchema extends BaseModel {
  static $columns = [
    'acknowledgedAt',
    'assignedTo',
    'category',
    'closedAt',
    'createdAt',
    'description',
    'id',
    'location',
    'occurredAt',
    'openedAt',
    'openedBy',
    'organizationId',
    'reference',
    'resolution',
    'resolvedAt',
    'resolvedBy',
    'severity',
    'status',
    'title',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = IncidentSchema.$columns
  @column.dateTime()
  declare acknowledgedAt: DateTime | null
  @column()
  declare assignedTo: string | null
  @column()
  declare category: string
  @column.dateTime()
  declare closedAt: DateTime | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare description: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare location: any | null
  @column.dateTime()
  declare occurredAt: DateTime
  @column.dateTime()
  declare openedAt: DateTime
  @column()
  declare openedBy: string | null
  @column()
  declare organizationId: string
  @column()
  declare reference: string
  @column()
  declare resolution: string | null
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
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleId: string | null
}
