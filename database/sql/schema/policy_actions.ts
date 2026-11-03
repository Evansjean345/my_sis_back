/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class PolicyActionSchema extends BaseModel {
  static $columns = [
    'actionType',
    'config',
    'createdAt',
    'id',
    'isActive',
    'orderIndex',
    'policyId',
    'updatedAt',
  ] as const
  $columns = PolicyActionSchema.$columns
  @column()
  declare actionType: string
  @column()
  declare config: any
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare orderIndex: number
  @column()
  declare policyId: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
