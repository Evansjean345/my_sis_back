/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class WebhookDeliverySchema extends BaseModel {
  static $columns = [
    'attempts',
    'createdAt',
    'deliveredAt',
    'errorMessage',
    'eventId',
    'eventType',
    'httpStatus',
    'id',
    'nextRetryAt',
    'payload',
    'responseBody',
    'status',
    'webhookEndpointId',
  ] as const
  $columns = WebhookDeliverySchema.$columns
  @column()
  declare attempts: number
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deliveredAt: DateTime | null
  @column()
  declare errorMessage: string | null
  @column()
  declare eventId: string | null
  @column()
  declare eventType: string
  @column()
  declare httpStatus: number | null
  @column({ isPrimary: true })
  declare id: bigint | number
  @column.dateTime()
  declare nextRetryAt: DateTime | null
  @column()
  declare payload: any
  @column()
  declare responseBody: string | null
  @column()
  declare status: string
  @column()
  declare webhookEndpointId: string
}
