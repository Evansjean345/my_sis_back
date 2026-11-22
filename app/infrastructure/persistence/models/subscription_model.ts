import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Souscription (tables `subscriptions`, migrations 027 et 028) : organisation ×
 * offre × groupe de véhicules. Prix en `numeric` sérialisés en chaîne :
 * `offerPrice` (prix de l'offre figé), `discount` (remise en montant) et
 * `totalPrice` (tarif appliqué = prix − remise, colonne GÉNÉRÉE par la base :
 * jamais écrite par l'application).
 */
export default class SubscriptionModel extends BaseModel {
  static table = 'subscriptions'

  @column({ isPrimary: true }) declare id: string
  @column() declare reference: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column({ columnName: 'offer_id' }) declare offerId: string
  @column({ columnName: 'vehicle_group_id' }) declare vehicleGroupId: string | null
  @column({ columnName: 'operator_id' }) declare operatorId: string | null
  @column({ columnName: 'offer_price' }) declare offerPrice: string
  @column() declare discount: string
  @column({ columnName: 'total_price' }) declare totalPrice: string
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
