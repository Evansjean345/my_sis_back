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
  operators: Map<string, { id: string; fullName: string; email: string }>
  vehicles: Map<string, number>
}

/** Résumés joints à une page de souscriptions — une requête par table. */
export async function subscriptionSummaries(
  rows: {
    organizationId: string
    offerId: string
    vehicleGroupId: string | null
    operatorId: string | null
  }[]
): Promise<SubscriptionSummaries> {
  const ids = (k: 'organizationId' | 'offerId' | 'vehicleGroupId' | 'operatorId') => [
    ...new Set(rows.map((r) => r[k]).filter((v): v is string => Boolean(v))),
  ]
  const operateurIds = ids('operatorId')
  const organisationIds = ids('organizationId')
  const offreIds = ids('offerId')
  const groupeIds = ids('vehicleGroupId')
  const [organisations, offres, groupes, operateurs, vehicules] = await Promise.all([
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
    operateurIds.length
      ? db.from('users').whereIn('id', operateurIds).select('id', 'full_name as fullName', 'email')
      : [],
    vehiclesByGroup(groupeIds),
  ])
  return {
    organizations: new Map(organisations.map((o: any) => [o.id, o])),
    offers: new Map(offres.map((o: any) => [o.id, o])),
    groups: new Map(groupes.map((g: any) => [g.id, g])),
    operators: new Map(operateurs.map((u: any) => [u.id, u])),
    vehicles: vehicules,
  }
}

export interface OrganizationSubscriptionRow {
  id: string
  reference: string
  status: string
  startDate: string
  endDate: string | null
  target: 'vehicle_group' | 'operator'
  offer: { id: string; code: string; name: string }
  vehicleGroup: { id: string; name: string } | null
  operator: { id: string; fullName: string } | null
}

/**
 * Souscriptions (non supprimées) d'une organisation, les plus récentes
 * d'abord. `operatorId` : seulement celles de cet opérateur ; `null` :
 * seulement les souscriptions de flotte ; absent : toutes.
 */
export async function subscriptionsOfOrganization(
  organizationId: string,
  operatorId?: string | null
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
    group_id: string | null
    group_name: string | null
    operator_id: string | null
    operator_name: string | null
  }[] = await db
    .from('subscriptions as s')
    .join('offers as o', 'o.id', 's.offer_id')
    .leftJoin('vehicle_groups as g', 'g.id', 's.vehicle_group_id')
    .leftJoin('users as u', 'u.id', 's.operator_id')
    .where('s.organization_id', organizationId)
    .whereNull('s.deleted_at')
    .if(operatorId !== undefined, (q) =>
      operatorId === null ? q.whereNull('s.operator_id') : q.where('s.operator_id', operatorId!)
    )
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
      'g.name as group_name',
      'u.id as operator_id',
      'u.full_name as operator_name'
    )
  return lignes.map((l) => ({
    id: l.id,
    reference: l.reference,
    status: l.status,
    startDate: l.start_date,
    endDate: l.end_date,
    target: l.operator_id ? ('operator' as const) : ('vehicle_group' as const),
    offer: { id: l.offer_id, code: l.offer_code, name: l.offer_name },
    vehicleGroup: l.group_id ? { id: l.group_id, name: l.group_name ?? '' } : null,
    operator: l.operator_id ? { id: l.operator_id, fullName: l.operator_name ?? '' } : null,
  }))
}

// ---------------------------------------------------------------------------
//  Clients finaux (opérateurs) — migration 030
// ---------------------------------------------------------------------------

export interface OrganizationUser {
  id: string
  organizationId: string
  fullName: string
  email: string
  status: string
  roleCode: string
  permissions: string[]
}

const userColumns = [
  'u.id',
  'u.organization_id as organizationId',
  'u.full_name as fullName',
  'u.email',
  'u.status',
  'r.code as roleCode',
  'r.permissions',
]

/** Compte vivant avec son rôle, ou `null`. */
export async function findOrganizationUser(id: string): Promise<OrganizationUser | null> {
  const ligne = await db
    .from('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', id)
    .whereNull('u.deleted_at')
    .select(userColumns)
    .first()
  return ligne ?? null
}

/** Comptes vivants d'une organisation avec leur rôle, par nom. */
export async function usersOfOrganization(organizationId: string): Promise<OrganizationUser[]> {
  return db
    .from('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('u.organization_id', organizationId)
    .whereNull('u.deleted_at')
    .orderBy('u.full_name')
    .select(userColumns)
}

/** Souscription non résiliée d'un opérateur (une seule possible), hors `exceptId`. */
export async function liveSubscriptionOfOperator(
  operatorId: string,
  exceptId?: string
): Promise<{ id: string; reference: string; status: string } | null> {
  const query = db
    .from('subscriptions')
    .where('operator_id', operatorId)
    .whereNull('deleted_at')
    .whereNot('status', 'terminated')
    .select('id', 'reference', 'status')
  if (exceptId) query.whereNot('id', exceptId)
  return (await query.first()) ?? null
}

/** Souscription non résiliée de chaque opérateur (avec son offre). */
export async function liveSubscriptionsOfOperators(
  operatorIds: string[]
): Promise<Map<string, { id: string; reference: string; status: string; offerName: string }>> {
  const parOperateur = new Map<
    string,
    { id: string; reference: string; status: string; offerName: string }
  >()
  if (operatorIds.length === 0) return parOperateur
  const lignes: {
    operator_id: string
    id: string
    reference: string
    status: string
    offer_name: string
  }[] = await db
    .from('subscriptions as s')
    .join('offers as o', 'o.id', 's.offer_id')
    .whereIn('s.operator_id', operatorIds)
    .whereNull('s.deleted_at')
    .whereNot('s.status', 'terminated')
    .select('s.operator_id', 's.id', 's.reference', 's.status', 'o.name as offer_name')
  for (const l of lignes) {
    parOperateur.set(l.operator_id, {
      id: l.id,
      reference: l.reference,
      status: l.status,
      offerName: l.offer_name,
    })
  }
  return parOperateur
}

export interface SubscribedOffer {
  id: string
  code: string
  name: string
  price: string
  currency: string
  periodicity: string
  status: string
}

/**
 * Offres que l'organisation a elle-même souscrites (souscriptions de FLOTTE
 * actives) : ce sont les seules qu'un distributeur peut attribuer à ses
 * opérateurs.
 */
export async function offersSubscribedByOrganization(
  organizationId: string
): Promise<SubscribedOffer[]> {
  return db
    .from('offers as o')
    .whereNull('o.deleted_at')
    .whereExists((q) =>
      q
        .from('subscriptions as s')
        .whereColumn('s.offer_id', 'o.id')
        .where('s.organization_id', organizationId)
        .whereNull('s.operator_id')
        .whereNull('s.deleted_at')
        .where('s.status', 'active')
    )
    .orderBy('o.name')
    .select('o.id', 'o.code', 'o.name', 'o.price', 'o.currency', 'o.periodicity', 'o.status')
}
