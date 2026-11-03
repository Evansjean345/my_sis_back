/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class IncidentAlertSchema extends BaseModel {
  static $columns = ['alertId', 'incidentId', 'linkedAt', 'linkedBy'] as const
  $columns = IncidentAlertSchema.$columns
  @column()
  declare alertId: string
  @column({ isPrimary: true })
  declare incidentId: string
  @column.dateTime()
  declare linkedAt: DateTime
  @column()
  declare linkedBy: string | null
}
