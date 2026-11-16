/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class IngestMessageSchema extends BaseModel {
  static $columns = [
    'deviceId',
    'deviceIdent',
    'errorMessage',
    'externalId',
    'id',
    'payload',
    'processedAt',
    'receivedAt',
    'source',
    'status',
  ] as const
  $columns = IngestMessageSchema.$columns
  @column()
  declare deviceId: string | null
  @column()
  declare deviceIdent: string | null
  @column()
  declare errorMessage: string | null
  @column()
  declare externalId: string
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare payload: any
  @column.dateTime()
  declare processedAt: DateTime | null
  @column.dateTime()
  declare receivedAt: DateTime
  @column()
  declare source: string
  @column()
  declare status: string
}
