/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class ReportJobSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'errorMessage',
    'expiresAt',
    'filePath',
    'fileSizeBytes',
    'finishedAt',
    'format',
    'id',
    'organizationId',
    'parameters',
    'reportType',
    'requestedBy',
    'rowsCount',
    'startedAt',
    'status',
  ] as const
  $columns = ReportJobSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare errorMessage: string | null
  @column.dateTime()
  declare expiresAt: DateTime
  @column()
  declare filePath: string | null
  @column()
  declare fileSizeBytes: bigint | number | null
  @column.dateTime()
  declare finishedAt: DateTime | null
  @column()
  declare format: string
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare organizationId: string
  @column()
  declare parameters: any
  @column()
  declare reportType: string
  @column()
  declare requestedBy: string | null
  @column()
  declare rowsCount: number | null
  @column.dateTime()
  declare startedAt: DateTime | null
  @column()
  declare status: string
}
