/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class GeofenceAssignmentSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'geofenceId',
    'id',
    'isActive',
    'notifyOnEnter',
    'notifyOnExit',
    'severity',
    'updatedAt',
    'usageScheduleId',
    'vehicleGroupId',
    'vehicleId',
  ] as const
  $columns = GeofenceAssignmentSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare geofenceId: string
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare notifyOnEnter: boolean
  @column()
  declare notifyOnExit: boolean
  @column()
  declare severity: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare usageScheduleId: string | null
  @column()
  declare vehicleGroupId: string | null
  @column()
  declare vehicleId: string | null
}
