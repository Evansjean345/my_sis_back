/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class AuditLogSchema extends BaseModel {
  static $columns = [
    'action',
    'actorId',
    'actorIp',
    'actorLabel',
    'actorType',
    'afterState',
    'beforeState',
    'id',
    'metadata',
    'occurredAt',
    'organizationId',
    'resourceId',
    'resourceType',
    'userAgent',
  ] as const
  $columns = AuditLogSchema.$columns
  @column()
  declare action: string
  @column()
  declare actorId: string | null
  @column()
  declare actorIp: string | null
  @column()
  declare actorLabel: string | null
  @column()
  declare actorType: string
  @column()
  declare afterState: any | null
  @column()
  declare beforeState: any | null
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare metadata: any
  @column.dateTime()
  declare occurredAt: DateTime
  @column()
  declare organizationId: string | null
  @column()
  declare resourceId: string | null
  @column()
  declare resourceType: string
  @column()
  declare userAgent: string | null
}
