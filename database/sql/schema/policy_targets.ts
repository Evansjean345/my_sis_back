/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class PolicyTargetSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'geofenceId',
    'id',
    'policyId',
    'scope',
    'vehicleGroupId',
    'vehicleId',
  ] as const
  $columns = PolicyTargetSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare geofenceId: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare policyId: string
  @column()
  declare scope: string
  @column()
  declare vehicleGroupId: string | null
  @column()
  declare vehicleId: string | null
}
