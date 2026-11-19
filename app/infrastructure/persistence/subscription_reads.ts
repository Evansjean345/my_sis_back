import db from '@adonisjs/lucid/services/db'

/**
 * Lectures agrégées sur les souscriptions (migration 027), partagées par les
 * contrôleurs des offres et des souscriptions.
 */

/** Véhicules vivants de chaque groupe. */
export async function vehiclesByGroup(groupIds: string[]): Promise<Map<string, number>> {
  const compte = new Map<string, number>()
  const ids = [...new Set(groupIds)]
  if (ids.length === 0) return compte
  const lignes: { vehicle_group_id: string; total: string | number }[] = await db
    .from('vehicle_group_members as m')
    .join('vehicles as v', 'v.id', 'm.vehicle_id')
    .whereIn('m.vehicle_group_id', ids)
    .whereNull('v.deleted_at')
    .groupBy('m.vehicle_group_id')
    .select('m.vehicle_group_id')
    .count('* as total')
  for (const l of lignes) compte.set(l.vehicle_group_id, Number(l.total))
  return compte
}

export interface OfferSubscriptionStats {
  /** Souscriptions non résiliées (brouillon, active, suspendue). */
  subscriptions: number
  activeSubscriptions: number
  /** Véhicules couverts par les souscriptions ACTIVES. */
  vehicles: number
  /** Organisations ayant une souscription non résiliée. */
  organizations: { id: string; code: string; name: string }[]
}

/** Statistiques de souscription de chaque offre — une requête par page. */
export async function statsByOffer(
  offerIds: string[]
): Promise<Map<string, OfferSubscriptionStats>> {
  const stats = new Map<string, OfferSubscriptionStats>()
  for (const id of offerIds) {
    stats.set(id, { subscriptions: 0, activeSubscriptions: 0, vehicles: 0, organizations: [] })
  }
  if (offerIds.length === 0) return stats

  const lignes: {
    offer_id: string
    status: string
    vehicle_group_id: string
    organization_id: string
    code: string
    name: string
  }[] = await db
    .from('subscriptions as s')
    .join('organizations as g', 'g.id', 's.organization_id')
    .whereIn('s.offer_id', offerIds)
    .whereNull('s.deleted_at')
    .whereNot('s.status', 'terminated')
    .orderBy('g.name')
    .select('s.offer_id', 's.status', 's.vehicle_group_id', 's.organization_id', 'g.code', 'g.name')

  const vehicules = await vehiclesByGroup(
    lignes.filter((l) => l.status === 'active').map((l) => l.vehicle_group_id)
  )
  for (const l of lignes) {
    const s = stats.get(l.offer_id)!
    s.subscriptions += 1
    if (l.status === 'active') {
      s.activeSubscriptions += 1
      s.vehicles += vehicules.get(l.vehicle_group_id) ?? 0
    }
    if (!s.organizations.some((o) => o.id === l.organization_id)) {
      s.organizations.push({ id: l.organization_id, code: l.code, name: l.name })
    }
  }
  return stats
}

// ---------------------------------------------------------------------------
//  Contrôles et résumés utilisés par l'API des souscriptions (aucun accès à la
//  base hors de cette couche : `npm run arch`).
// ---------------------------------------------------------------------------

/** L'organisation existe-t-elle (non supprimée) ? */
export async function organizationExists(id: string): Promise<boolean> {
  const ligne = await db
    .from('organizations')
    .where('id', id)
    .whereNull('deleted_at')
    .select('id')
    .first()
  return Boolean(ligne)
}

export interface VehicleGroupRef {
  id: string
  organizationId: string
  name: string
}

/** Groupe de véhicules vivant, ou `null`. */
export async function findVehicleGroup(id: string): Promise<VehicleGroupRef | null> {
  const ligne = await db
    .from('vehicle_groups')
    .where('id', id)
    .whereNull('deleted_at')
    .select('id', 'organization_id', 'name')
    .first()
  return ligne ? { id: ligne.id, organizationId: ligne.organization_id, name: ligne.name } : null
}

/** Souscription non résiliée d'un groupe (une seule possible), hors `exceptId`. */
export async function liveSubscriptionOfGroup(
  groupId: string,
  exceptId?: string
): Promise<{ id: string; reference: string; status: string } | null> {
  const query = db
    .from('subscriptions')
    .where('vehicle_group_id', groupId)
    .whereNull('deleted_at')
    .whereNot('status', 'terminated')
    .select('id', 'reference', 'status')
  if (exceptId) query.whereNot('id', exceptId)
  return (await query.first()) ?? null
}

/** Référence déjà portée par une autre souscription vivante (casse ignorée) ? */
export async function subscriptionReferenceTaken(
  reference: string,
  exceptId?: string
): Promise<boolean> {
  const query = db
    .from('subscriptions')
    .whereRaw('lower(reference) = lower(?)', [reference])
    .whereNull('deleted_at')
    .select('id')
  if (exceptId) query.whereNot('id', exceptId)
  return Boolean(await query.first())
}

export interface SubscriptionSummaries {
  organizations: Map<string, { id: string; code: string; name: string }>
  offers: Map<
    string,
    {
      id: string
      code: string
      name: string
      periodicity: string
      price: string
      currency: string
      status: string
    }
  >
  groups: Map<string, { id: string; name: string; color: string | null }>
  vehicles: Map<string, number>
}

/** Résumés joints à une page de souscriptions — une requête par table. */
export async function subscriptionSummaries(
  rows: { organizationId: string; offerId: string; vehicleGroupId: string }[]
): Promise<SubscriptionSummaries> {
  const ids = (k: 'organizationId' | 'offerId' | 'vehicleGroupId') => [
    ...new Set(rows.map((r) => r[k])),
  ]
  const organisationIds = ids('organizationId')
  const offreIds = ids('offerId')
  const groupeIds = ids('vehicleGroupId')
  const [organisations, offres, groupes, vehicules] = await Promise.all([
    organisationIds.length
      ? db.from('organizations').whereIn('id', organisationIds).select('id', 'code', 'name')
      : [],
    offreIds.length
      ? db
          .from('offers')
          .whereIn('id', offreIds)
          .select('id', 'code', 'name', 'periodicity', 'price', 'currency', 'status')
      : [],
    groupeIds.length
      ? db.from('vehicle_groups').whereIn('id', groupeIds).select('id', 'name', 'color')
      : [],
    vehiclesByGroup(groupeIds),
  ])
  return {
    organizations: new Map(organisations.map((o: any) => [o.id, o])),
    offers: new Map(offres.map((o: any) => [o.id, o])),
    groups: new Map(groupes.map((g: any) => [g.id, g])),
    vehicles: vehicules,
  }
}

export interface OrganizationSubscriptionRow {
  id: string
  reference: string
  status: string
  startDate: string
  endDate: string | null
  offer: { id: string; code: string; name: string }
  vehicleGroup: { id: string; name: string }
}

/** Souscriptions d'une organisation (non supprimées), les plus récentes d'abord. */
export async function subscriptionsOfOrganization(
  organizationId: string
): Promise<OrganizationSubscriptionRow[]> {
  const lignes: {
    id: string
    reference: string
    status: string
    start_date: string
    end_date: string | null
    offer_id: string
    offer_code: string
    offer_name: string
    group_id: string
    group_name: string
  }[] = await db
    .from('subscriptions as s')
    .join('offers as o', 'o.id', 's.offer_id')
    .join('vehicle_groups as g', 'g.id', 's.vehicle_group_id')
    .where('s.organization_id', organizationId)
    .whereNull('s.deleted_at')
    .orderBy('s.created_at', 'desc')
    .select(
      's.id',
      's.reference',
      's.status',
      db.raw(`to_char(s.start_date, 'YYYY-MM-DD') as start_date`),
      db.raw(`to_char(s.end_date, 'YYYY-MM-DD') as end_date`),
      'o.id as offer_id',
      'o.code as offer_code',
      'o.name as offer_name',
      'g.id as group_id',
      'g.name as group_name'
    )
  return lignes.map((l) => ({
    id: l.id,
    reference: l.reference,
    status: l.status,
    startDate: l.start_date,
    endDate: l.end_date,
    offer: { id: l.offer_id, code: l.offer_code, name: l.offer_name },
    vehicleGroup: { id: l.group_id, name: l.group_name },
  }))
}
