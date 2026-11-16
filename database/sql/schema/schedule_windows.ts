/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'

export class ScheduleWindowSchema extends BaseModel {
  static $columns = ['dayOfWeek', 'endTime', 'id', 'startTime', 'usageScheduleId'] as const
  $columns = ScheduleWindowSchema.$columns
  @column()
  declare dayOfWeek: number
  @column()
  declare endTime: string
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare startTime: string
  @column()
  declare usageScheduleId: string
}
