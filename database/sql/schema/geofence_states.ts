/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class GeofenceStateSchema extends BaseModel {
  static $columns = ['geofenceId', 'isInside', 'lastEvaluatedAt', 'since', 'vehicleId'] as const
  $columns = GeofenceStateSchema.$columns
  @column()
  declare geofenceId: string
  @column()
  declare isInside: boolean
  @column.dateTime()
  declare lastEvaluatedAt: DateTime
  @column.dateTime()
  declare since: DateTime
  @column({ isPrimary: true })
  declare vehicleId: string
}
