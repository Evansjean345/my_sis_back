import db from '@adonisjs/lucid/services/db'
import OfferModel from '#infrastructure/persistence/models/offer_model'
import { setOfferSubFeatures } from '#infrastructure/persistence/feature_catalogue'

/**
 * Écritures des offres qui touchent plusieurs tables : l'offre et ses
 * sous-fonctionnalités (`offer_sub_features`) changent dans UNE transaction.
 */

/** Crée l'offre et lui rattache `subFeatureIds`. */
export function createOfferWithSubFeatures(
  attributes: Partial<OfferModel>,
  subFeatureIds: number[]
): Promise<OfferModel> {
  return db.transaction(async (trx) => {
    const offre = await OfferModel.create(attributes, { client: trx })
    await setOfferSubFeatures(trx, offre.id, subFeatureIds)
    return offre
  })
}

/**
 * Applique `changes` à l'offre puis, si `subFeatureIds` n'est pas `null`,
 * remplace ses sous-fonctionnalités.
 */
export async function updateOfferWithSubFeatures(
  offre: OfferModel,
  changes: (offre: OfferModel) => void,
  subFeatureIds: number[] | null
): Promise<void> {
  await db.transaction(async (trx) => {
    offre.useTransaction(trx)
    changes(offre)
    await offre.save()
    if (subFeatureIds) await setOfferSubFeatures(trx, offre.id, subFeatureIds)
  })
}
