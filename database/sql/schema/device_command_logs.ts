/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DeviceCommandLogSchema extends BaseModel {
  static $columns = [
    'actorId',
    'actorIp',
    'actorType',
    'commandId',
    'createdAt',
    'id',
    'note',
    'payload',
    'statusFrom',
    'statusTo',
  ] as const
  $columns = DeviceCommandLogSchema.$columns
  @column()
  declare actorId: string | null
  @column()
  declare actorIp: string | null
  @column()
  declare actorType: string
  @column()
  declare commandId: string
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare note: string | null
  @column()
  declare payload: any
  @column()
  declare statusFrom: string | null
  @column()
  declare statusTo: string
}
