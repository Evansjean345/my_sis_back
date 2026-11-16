/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class GeofenceSchema extends BaseModel {
  static $columns = [
    'areaM2',
    'center',
    'color',
    'createdAt',
    'createdBy',
    'deletedAt',
    'description',
    'geom',
    'id',
    'isActive',
    'kind',
    'name',
    'organizationId',
    'radiusM',
    'shapeType',
    'updatedAt',
  ] as const
  $columns = GeofenceSchema.$columns
  @column()
  declare areaM2: string | null
  @column()
  declare center: any | null
  @column()
  declare color: string | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare createdBy: string | null
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare description: string | null
  @column()
  declare geom: any
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare kind: string
  @column()
  declare name: string
  @column()
  declare organizationId: string
  @column()
  declare radiusM: string | null
  @column()
  declare shapeType: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
