/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class PolicyExecutionSchema extends BaseModel {
  static $columns = [
    'actionsResult',
    'errorMessage',
    'eventId',
    'finishedAt',
    'id',
    'policyId',
    'policyVersion',
    'startedAt',
    'status',
    'vehicleId',
  ] as const
  $columns = PolicyExecutionSchema.$columns
  @column()
  declare actionsResult: any
  @column()
  declare errorMessage: string | null
  @column()
  declare eventId: string | null
  @column.dateTime()
  declare finishedAt: DateTime | null
  @column({ isPrimary: true })
  declare id: bigint | number
  @column()
  declare policyId: string
  @column()
  declare policyVersion: number
  @column.dateTime()
  declare startedAt: DateTime
  @column()
  declare status: string
  @column()
  declare vehicleId: string | null
}
