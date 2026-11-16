/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class OutboxMessageSchema extends BaseModel {
  static $columns = [
    'aggregateId',
    'aggregateType',
    'attempts',
    'availableAt',
    'createdAt',
    'id',
    'lastError',
    'lockedAt',
    'lockedBy',
    'payload',
    'publishedAt',
    'status',
    'topic',
  ] as const
  $columns = OutboxMessageSchema.$columns
  @column()
  declare aggregateId: string | null
  @column()
  declare aggregateType: string
  @column()
  declare attempts: number
  @column.dateTime()
  declare availableAt: DateTime
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare lastError: string | null
  @column.dateTime()
  declare lockedAt: DateTime | null
  @column()
  declare lockedBy: string | null
  @column()
  declare payload: any
  @column.dateTime()
  declare publishedAt: DateTime | null
  @column()
  declare status: string
  @column()
  declare topic: string
}
