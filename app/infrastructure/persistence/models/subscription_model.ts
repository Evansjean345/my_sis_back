import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Souscription (table `subscriptions`, migration 027) : organisation × offre ×
 * groupe de véhicules. `unitPrice` (tarif appliqué) est un `numeric` sérialisé
 * en chaîne ; le montant et le nombre de véhicules sont calculés à la lecture.
 */
export default class SubscriptionModel extends BaseModel {
  static table = 'subscriptions'

  @column({ isPrimary: true }) declare id: string
  @column() declare reference: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column({ columnName: 'offer_id' }) declare offerId: string
  @column({ columnName: 'vehicle_group_id' }) declare vehicleGroupId: string
  @column({ columnName: 'unit_price' }) declare unitPrice: string
  @column() declare currency: string
  @column() declare status: string
  @column.date({ columnName: 'start_date' }) declare startDate: DateTime
  @column.date({ columnName: 'end_date' }) declare endDate: DateTime | null
  @column() declare notes: string | null
  @column({ columnName: 'created_by', serializeAs: null }) declare createdBy: string | null
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
