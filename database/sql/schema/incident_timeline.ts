/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class IncidentTimelineSchema extends BaseModel {
  static $columns = [
    'authorId',
    'content',
    'createdAt',
    'id',
    'incidentId',
    'kind',
    'metadata',
  ] as const
  $columns = IncidentTimelineSchema.$columns
  @column()
  declare authorId: string | null
  @column()
  declare content: string | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare incidentId: string
  @column()
  declare kind: string
  @column()
  declare metadata: any
}
