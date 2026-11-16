/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class WebhookEndpointSchema extends BaseModel {
  static $columns = [
    'consecutiveFailures',
    'createdAt',
    'createdBy',
    'deletedAt',
    'eventTypes',
    'id',
    'isActive',
    'lastFailureAt',
    'lastSuccessAt',
    'maxAttempts',
    'name',
    'organizationId',
    'secretHash',
    'timeoutMs',
    'updatedAt',
    'url',
  ] as const
  $columns = WebhookEndpointSchema.$columns
  @column()
  declare consecutiveFailures: number
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare createdBy: string | null
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare eventTypes: any
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column.dateTime()
  declare lastFailureAt: DateTime | null
  @column.dateTime()
  declare lastSuccessAt: DateTime | null
  @column()
  declare maxAttempts: number
  @column()
  declare name: string
  @column()
  declare organizationId: string
  @column()
  declare secretHash: string
  @column()
  declare timeoutMs: number
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare url: string
}
