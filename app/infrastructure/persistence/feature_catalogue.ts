import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * =========================================================================
 *  CATALOGUE DES FONCTIONNALITÉS (migration 026) — accès en lecture/écriture
 * =========================================================================
 *
 * `features` (un nom) → `sub_features` (clé, libellé, page) ; les offres
 * pointent vers les sous-fonctionnalités par `offer_sub_features`. L'ordre
 * d'affichage est celui des identifiants (ordre d'insertion).
 *
 * Forme exposée par l'API — les sous-fonctionnalités sont des sous-objets :
 *   [{ id, name, subFeatures: [{ id, key, label, path }] }]
 */

export interface SubFeature {
  id: number
  key: string
  label: string
  path: string
}

export interface Feature {
  id: number
  name: string
  subFeatures: SubFeature[]
}

type Client = TransactionClientContract | typeof db

/** Catalogue complet, fonctionnalités et sous-fonctionnalités ordonnées. */
export async function loadCatalogue(client: Client = db): Promise<Feature[]> {
  const lignes: {
    feature_id: number
    name: string
    id: number | null
    key: string | null
    label: string | null
    path: string | null
  }[] = await client
    .from('features as f')
    .leftJoin('sub_features as s', 's.feature_id', 'f.id')
    .orderBy('f.id')
    .orderBy('s.id')
    .select('f.id as feature_id', 'f.name', 's.id', 's.key', 's.label', 's.path')

  const parId = new Map<number, Feature>()
  for (const l of lignes) {
    const feature = parId.get(l.feature_id) ?? { id: l.feature_id, name: l.name, subFeatures: [] }
    if (l.id !== null && l.key && l.label && l.path) {
      feature.subFeatures.push({ id: l.id, key: l.key, label: l.label, path: l.path })
    }
    parId.set(l.feature_id, feature)
  }
  return [...parId.values()]
}

/** Ne garde du catalogue que les sous-fonctionnalités `keys` (fonctionnalités vides retirées). */
export function restrictCatalogue(catalogue: Feature[], keys: Iterable<string>): Feature[] {
  const voulues = new Set(keys)
  return catalogue
    .map((f) => ({ ...f, subFeatures: f.subFeatures.filter((s) => voulues.has(s.key)) }))
    .filter((f) => f.subFeatures.length > 0)
}

/** Pages ouvertes par des sous-fonctionnalités, sans doublon, dans l'ordre du catalogue. */
export function pathsOf(catalogue: Feature[], keys?: Iterable<string>): string[] {
  const voulues = keys ? new Set(keys) : null
  const pages: string[] = []
  for (const f of catalogue) {
    for (const s of f.subFeatures) {
      if ((!voulues || voulues.has(s.key)) && !pages.includes(s.path)) pages.push(s.path)
    }
  }
  return pages
}

/** Clés → identifiants ; `unknown` liste les clés absentes du catalogue. */
export async function resolveKeys(
  keys: string[],
  client: Client = db
): Promise<{ ids: number[]; unknown: string[] }> {
  if (keys.length === 0) return { ids: [], unknown: [] }
  const lignes: { id: number; key: string }[] = await client
    .from('sub_features')
    .whereIn('key', keys)
    .select('id', 'key')
  const connues = new Map(lignes.map((l) => [l.key, l.id]))
  return {
    ids: keys.filter((k) => connues.has(k)).map((k) => connues.get(k)!),
    unknown: keys.filter((k) => !connues.has(k)),
  }
}

/** Clés incluses dans chaque offre, dans l'ordre du catalogue. */
export async function keysByOffer(
  offerIds: string[],
  client: Client = db
): Promise<Map<string, string[]>> {
  const parOffre = new Map<string, string[]>()
  if (offerIds.length === 0) return parOffre
  const lignes: { offer_id: string; key: string }[] = await client
    .from('offer_sub_features as l')
    .join('sub_features as s', 's.id', 'l.sub_feature_id')
    .whereIn('l.offer_id', offerIds)
    .orderBy('s.id')
    .select('l.offer_id', 's.key')
  for (const l of lignes) parOffre.set(l.offer_id, [...(parOffre.get(l.offer_id) ?? []), l.key])
  return parOffre
}

/** Remplace les sous-fonctionnalités d'une offre. */
export async function setOfferSubFeatures(
  trx: TransactionClientContract,
  offerId: string,
  subFeatureIds: number[]
): Promise<void> {
  await trx.from('offer_sub_features').where('offer_id', offerId).delete()
  if (subFeatureIds.length) {
    await trx
      .table('offer_sub_features')
      .insert(subFeatureIds.map((id) => ({ offer_id: offerId, sub_feature_id: id })))
  }
}
