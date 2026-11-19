import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Offre commerciale (table `offers`, migration 022).
 *
 * `price` est un `numeric` PostgreSQL : sérialisé en chaîne (« 25000.00 »),
 * sans perte de précision. Sous-fonctionnalités incluses : `offer_sub_features`
 * (migration 026) ; organisations : par leurs souscriptions (migration 027).
 */
export default class OfferModel extends BaseModel {
  static table = 'offers'

  @column({ isPrimary: true }) declare id: string
  @column() declare code: string
  @column() declare name: string
  @column() declare description: string | null
  @column() declare price: string
  @column() declare currency: string
  @column() declare periodicity: string
  @column() declare status: string
  @column.date({ columnName: 'launched_on' }) declare launchedOn: DateTime | null
  @column({ columnName: 'max_vehicles' }) declare maxVehicles: number | null
  @column({ columnName: 'gps_history_days' }) declare gpsHistoryDays: number
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
