/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class NotificationSchema extends BaseModel {
  static $columns = [
    'alertId',
    'attempts',
    'body',
    'channel',
    'costAmount',
    'currency',
    'dedupKey',
    'deliveredAt',
    'errorMessage',
    'failedAt',
    'id',
    'incidentId',
    'nextRetryAt',
    'organizationId',
    'payload',
    'provider',
    'providerMessageId',
    'queuedAt',
    'recipientAddress',
    'recipientUserId',
    'segments',
    'sentAt',
    'status',
    'subject',
    'templateCode',
  ] as const
  $columns = NotificationSchema.$columns
  @column()
  declare alertId: string | null
  @column()
  declare attempts: number
  @column()
  declare body: string
  @column()
  declare channel: string
  @column()
  declare costAmount: string | null
  @column()
  declare currency: string | null
  @column()
  declare dedupKey: string | null
  @column.dateTime()
  declare deliveredAt: DateTime | null
  @column()
  declare errorMessage: string | null
  @column.dateTime()
  declare failedAt: DateTime | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare incidentId: string | null
  @column.dateTime()
  declare nextRetryAt: DateTime | null
  @column()
  declare organizationId: string
  @column()
  declare payload: any
  @column()
  declare provider: string | null
  @column()
  declare providerMessageId: string | null
  @column.dateTime()
  declare queuedAt: DateTime
  @column()
  declare recipientAddress: string
  @column()
  declare recipientUserId: string | null
  @column()
  declare segments: number
  @column.dateTime()
  declare sentAt: DateTime | null
  @column()
  declare status: string
  @column()
  declare subject: string | null
  @column()
  declare templateCode: string | null
}
