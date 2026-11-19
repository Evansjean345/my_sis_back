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
