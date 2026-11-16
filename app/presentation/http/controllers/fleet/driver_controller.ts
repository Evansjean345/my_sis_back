import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { ForbiddenError } from '#domain/kernel'
import DriverModel from '#infrastructure/persistence/models/driver_model'
import DriverGroupModel from '#infrastructure/persistence/models/driver_group_model'
import VehicleModel from '#infrastructure/persistence/models/vehicle_model'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  adminListDriversValidator,
  assignDriverGroupsValidator,
  assignDriverOrganizationValidator,
  assignDriverVehicleValidator,
  createDriverValidator,
  listDriversValidator,
  updateDriverValidator,
} from '#presentation/http/validators/fleet/driver_validators'
import { LucidDriverGroupMembership } from '#infrastructure/persistence/repositories/group_membership_repository'
import { authorize } from '#presentation/http/support/authorize'
import { organizationScope } from '#presentation/http/support/organization_scope'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform, organizationsOf } from '#presentation/http/support/platform_scope'
import { notFoundInScope, vehicleInScope } from '#presentation/http/support/tenant_resources'

/** Champs suivis dans l'audit (avant / après). */
const AUDITED = [
  'organizationId',
  'firstName',
  'lastName',
  'phone',
  'email',
  'employeeCode',
  'licenseNumber',
  'licenseCategories',
  'licenseExpiresOn',
  'status',
  'vehicleId',
] as const

type Filtres = {
  page?: number
  perPage?: number
  search?: string
  status?: string
  vehicleId?: string
  driverGroupId?: string
  unassigned?: boolean
  withoutOrganization?: boolean
}

type OrganisationResolue =
  | { ok: true; organizationId: string | null }
  | { ok: false; reponse: ReturnType<HttpContext['response']['notFound']> }

/**
 * =========================================================================
 *  CONDUCTEURS — style PRAGMATIQUE (contrôleur → Lucid)
 * =========================================================================
 *
 * L'organisation d'un conducteur est FACULTATIVE (migration 019) et vient de
 * la requête (`organizationId`), jamais imposée en dur :
 *
 *   - absente  → organisation de l'acteur (compte client), aucune (exploitant) ;
 *   - uuid     → cette organisation ; un compte client ne peut viser que la sienne ;
 *   - null     → aucune organisation : vivier de l'exploitant, invisible des
 *                routes client (réservé au détenteur du joker `*`).
 *
 * Un conducteur rattaché à une organisation ne conduit que les véhicules de
 * celle-ci ; un conducteur sans organisation peut être rattaché au véhicule
 * de n'importe quel client. Les invariants structurels sont tenus par
 * la base (unicité du permis et du matricule, trigger de cloisonnement
 * conducteur ↔ véhicule) ; le contrôleur les pré-vérifie seulement pour
 * produire des erreurs actionnables.
 *
 * Habilitations : `vehicle:read` / `vehicle:write`. Gérer les conducteurs,
 * c'est gérer la flotte — aucune habilitation nouvelle, la matrice des trois
 * rôles reste celle de la migration 016.
 *
 * Le rattachement au véhicule est audité avant / après : c'est l'historique
 * « qui conduisait ce véhicule à telle date ».
 */
@inject()
export default class DriverController {
  constructor(
    private readonly audit: LucidAuditLogger,
    private readonly groupes: LucidDriverGroupMembership
  ) {}

  /** GET /drivers ?search=&status=&vehicleId=&driverGroupId=&unassigned=&page=&perPage= */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const scope = await organizationScope(ctx)
    const filtres = await ctx.request.validateUsing(listDriversValidator)
    return this.lister(ctx, filtres, scope.organizationId)
  }

  /** POST /drivers — `organizationId` facultatif, défaut : l'organisation de l'acteur. */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const scope = await organizationScope(ctx)
    return this.creer(ctx, scope.organizationId)
  }

  /** GET /drivers/:id — conducteur, véhicule rattaché et groupes. */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    const [vehicules, groupes] = await Promise.all([
      this.vehiculesDe([conducteur]),
      this.groupesDe(conducteur.id),
    ])
    return ctx.response.ok({
      data: {
        ...conducteur.serialize(),
        vehicle: conducteur.vehicleId ? (vehicules[conducteur.vehicleId] ?? null) : null,
        groups: groupes,
      },
    })
  }

  /** PATCH /drivers/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(updateDriverValidator)
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    const { organizationId: demandee, licenseExpiresOn, ...champs } = payload
    const organisation = await this.resoudreOrganisation(ctx, demandee, conducteur.organizationId)
    if (!organisation.ok) return organisation.reponse
    const cible = organisation.organizationId
    const changeOrganisation = cible !== conducteur.organizationId

    // Le véhicule (nouveau, ou conservé) doit être compatible avec l'organisation CIBLE.
    const vehicule = champs.vehicleId !== undefined ? champs.vehicleId : conducteur.vehicleId
    if (vehicule && !(await this.vehiculeValide(cible, vehicule))) {
      return this.vehiculeHorsPerimetre(ctx, vehicule)
    }

    // Valeur après écriture : la nouvelle si fournie (null = effacée), sinon l'actuelle —
    // à revérifier seulement si l'organisation change (autre périmètre d'unicité).
    const apres = <K extends 'licenseNumber' | 'employeeCode'>(k: K) =>
      champs[k] !== undefined ? champs[k] : changeOrganisation ? conducteur[k] : null
    const doublon = await this.identifiantPris(
      cible,
      { licenseNumber: apres('licenseNumber'), employeeCode: apres('employeeCode') },
      conducteur.id
    )
    if (doublon) return this.identifiantDejaPris(ctx, doublon)

    const avant = this.resume(conducteur)
    conducteur.merge(champs)
    conducteur.organizationId = cible
    if (licenseExpiresOn !== undefined) {
      conducteur.licenseExpiresOn = licenseExpiresOn ? DateTime.fromISO(licenseExpiresOn) : null
    }
    await conducteur.save()
    await conducteur.refresh()

    // Changement d'organisation : il quitte les groupes de l'ancienne.
    const groupesQuittes = changeOrganisation
      ? await this.groupes.pruneForeignMemberships(conducteur.id, cible)
      : 0

    await this.tracer(ctx, conducteur.organizationId, 'updated', conducteur.id, {
      before: avant,
      after: this.resume(conducteur),
      ...(groupesQuittes ? { metadata: { groupsLeft: groupesQuittes } } : {}),
    })
    return ctx.response.ok({ data: conducteur.serialize() })
  }

  /**
   * DELETE /drivers/:id — suppression LOGIQUE.
   *
   * Le conducteur est détaché de son véhicule (il ne doit plus apparaître
   * comme conducteur du véhicule) mais reste lisible dans l'audit.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    const avant = this.resume(conducteur)
    conducteur.vehicleId = null
    conducteur.deletedAt = DateTime.now()
    await conducteur.save()

    await this.tracer(ctx, conducteur.organizationId, 'deleted', conducteur.id, { before: avant })
    return ctx.response.noContent()
  }

  /** PUT /drivers/:id/vehicle — body : { vehicleId: uuid | null } */
  async assignVehicle(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const { vehicleId } = await ctx.request.validateUsing(assignDriverVehicleValidator)
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    if (vehicleId && !(await this.vehiculeValide(conducteur.organizationId, vehicleId))) {
      return this.vehiculeHorsPerimetre(ctx, vehicleId)
    }

    const precedent = conducteur.vehicleId
    if (precedent !== vehicleId) {
      conducteur.vehicleId = vehicleId
      await conducteur.save()
      await this.tracer(
        ctx,
        conducteur.organizationId,
        vehicleId ? 'vehicle_assigned' : 'vehicle_unassigned',
        conducteur.id,
        { before: { vehicleId: precedent }, after: { vehicleId } }
      )
    }

    const vehicules = await this.vehiculesDe([conducteur])
    return ctx.response.ok({
      data: {
        ...conducteur.serialize(),
        vehicle: conducteur.vehicleId ? (vehicules[conducteur.vehicleId] ?? null) : null,
      },
    })
  }

  /** GET /vehicles/:id/drivers — conducteurs rattachés à un véhicule. */
  async vehicleDrivers(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const vehicule = await vehicleInScope(ctx, ctx.params.id)
    if (!vehicule) return notFoundInScope(ctx, 'Véhicule')

    const conducteurs = await DriverModel.query()
      .where('vehicle_id', vehicule.id)
      // ses conducteurs, et ceux du vivier sans organisation qui le conduisent
      .where((q) =>
        q.where('organization_id', vehicule.organizationId).orWhereNull('organization_id')
      )
      .whereNull('deleted_at')
      .orderBy('full_name')
    return ctx.response.ok({
      data: conducteurs.map((c) => c.serialize()),
      meta: { total: conducteurs.length },
    })
  }

  // =========================================================================
  //  GROUPES D'UN CONDUCTEUR — vue depuis le conducteur
  // =========================================================================
  //
  //  Complément des routes `/driver-groups/:id/drivers` (vue depuis le
  //  groupe) : la fiche d'un conducteur ajoute ou retire SES groupes. Même
  //  règle de cloisonnement : un groupe appartient à une organisation, le
  //  conducteur doit appartenir à la même. Ouvert à l'admin client (sa
  //  flotte) et à l'exploitant (toutes les flottes).

  /** GET /drivers/:id/groups */
  async groups(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    const groupes = await this.groupesDe(conducteur.id)
    return ctx.response.ok({ data: groupes, meta: { total: groupes.length } })
  }

  /**
   * POST /drivers/:id/groups — body : { driverGroupIds: [...] }
   *
   * IDEMPOTENT. Réponse `{ applied, unchanged, rejected }` : un groupe
   * inconnu, supprimé ou d'une AUTRE organisation ressort en `rejected`.
   */
  async attachGroups(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const { driverGroupIds } = await ctx.request.validateUsing(assignDriverGroupsValidator)
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    if (!conducteur.organizationId) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_DRIVER_WITHOUT_ORGANIZATION',
          message:
            "Ce conducteur n'appartient à aucune organisation : le rattacher à une organisation avant de l'ajouter à un groupe",
          details: {},
        },
      })
    }

    const candidats = [...new Set(driverGroupIds)]
    const eligibles = await DriverGroupModel.query()
      .whereIn('id', candidats)
      .where('organization_id', conducteur.organizationId)
      .whereNull('deleted_at')
      .select('id', 'name')

    const applied: string[] = []
    const unchanged: string[] = []
    for (const groupe of eligibles) {
      const r = await this.groupes.add(groupe.id, conducteur.organizationId, [conducteur.id])
      if (r.applied.length > 0) {
        applied.push(groupe.id)
        await this.tracerGroupe(ctx, conducteur, groupe.id, 'members_added')
      } else {
        unchanged.push(groupe.id)
      }
    }
    const eligibleIds = new Set(eligibles.map((g) => g.id))
    const rejected = candidats.filter((id) => !eligibleIds.has(id))

    if (applied.length === 0 && unchanged.length === 0) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_GROUPS_OUT_OF_SCOPE',
          message:
            "Aucun groupe exploitable : identifiants inconnus, supprimés ou hors de l'organisation du conducteur",
          details: { rejected },
        },
      })
    }

    return ctx.response.ok({
      data: { applied, unchanged, rejected, groups: await this.groupesDe(conducteur.id) },
    })
  }

  /** DELETE /drivers/:id/groups/:groupId — retirer le conducteur d'un groupe. */
  async detachGroup(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    const r = await this.groupes.remove(ctx.params.groupId, [conducteur.id])
    if (r.applied.length === 0) {
      return ctx.response.notFound({
        error: {
          code: 'E_NOT_FOUND',
          message: "Ce conducteur n'appartient pas à ce groupe",
          details: { driverGroupId: ctx.params.groupId },
        },
      })
    }
    await this.tracerGroupe(ctx, conducteur, ctx.params.groupId, 'members_removed')
    return ctx.response.noContent()
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /**
   * PUT /admin/drivers/:id/organization — body : { organizationId }
   *
   * Ajoute le conducteur à une organisation (ou le DÉPLACE d'une organisation
   * à une autre). Conséquences, appliquées dans la foulée et signalées dans
   * la réponse :
   *   - le véhicule rattaché est retiré s'il n'appartient pas à la nouvelle
   *     organisation (`vehicleDetached`) ;
   *   - le conducteur quitte les groupes de l'ancienne (`groupsLeft`).
   */
  async assignOrganization(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(assignDriverOrganizationValidator)
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    const organisation = await this.resoudreOrganisation(ctx, organizationId, null)
    if (!organisation.ok) return organisation.reponse
    return this.changerOrganisation(ctx, conducteur, organizationId)
  }

  /**
   * DELETE /admin/drivers/:id/organization
   *
   * Retire le conducteur de son organisation : il rejoint le vivier de
   * l'exploitant, invisible des routes client. Il est détaché de son véhicule
   * (qui appartient au client qu'il quitte) et retiré de tous ses groupes.
   */
  async removeOrganization(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')
    return this.changerOrganisation(ctx, conducteur, null)
  }

  /** GET /admin/drivers ?organizationId=&withoutOrganization=&… */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId, ...filtres } =
      await ctx.request.validateUsing(adminListDriversValidator)
    return this.lister(ctx, filtres, organizationId ?? null, true)
  }

  /**
   * POST /admin/drivers — body : { organizationId?, firstName, lastName, … }
   * Sans `organizationId`, le conducteur rejoint le vivier sans organisation.
   */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.creer(ctx, null)
  }

  // -------------------------------------------------------------------------

  private async lister(
    ctx: HttpContext,
    f: Filtres,
    organizationId: string | null,
    avecOrganisation = false
  ) {
    const query = DriverModel.query().whereNull('deleted_at').orderBy('full_name')
    if (organizationId) query.where('organization_id', organizationId)
    if (f.withoutOrganization) query.whereNull('organization_id')
    if (f.status) query.where('status', f.status)
    if (f.vehicleId) query.where('vehicle_id', f.vehicleId)
    if (f.unassigned) query.whereNull('vehicle_id')
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) =>
        q
          .whereILike('full_name', motif)
          .orWhereILike('employee_code', motif)
          .orWhereILike('license_number', motif)
      )
    }
    if (f.driverGroupId) {
      // Le groupe est croisé avec l'organisation du conducteur : un groupe
      // d'un autre client ne sélectionne rien.
      const groupId = f.driverGroupId
      query.whereExists((sub) =>
        sub
          .from('driver_group_members as m')
          .join('driver_groups as g', 'g.id', 'm.driver_group_id')
          .whereRaw('m.driver_id = drivers.id')
          .whereRaw('g.organization_id = drivers.organization_id')
          .where('g.id', groupId)
          .whereNull('g.deleted_at')
      )
    }

    const page = await query.paginate(f.page ?? 1, Math.min(f.perPage ?? 25, 100))
    const lignes = page.all()
    const [vehicules, organisations] = await Promise.all([
      this.vehiculesDe(lignes),
      avecOrganisation
        ? organizationsOf(lignes.map((l) => l.organizationId).filter((o): o is string => !!o))
        : Promise.resolve({}),
    ])

    return ctx.response.ok({
      meta: page.getMeta(),
      data: lignes.map((c) => ({
        ...c.serialize(),
        vehicle: c.vehicleId ? (vehicules[c.vehicleId] ?? null) : null,
        ...(avecOrganisation
          ? {
              organization: c.organizationId
                ? ((organisations as Record<string, unknown>)[c.organizationId] ?? null)
                : null,
            }
          : {}),
      })),
    })
  }

  /** `parDefaut` : organisation retenue quand la requête ne précise rien. */
  private async creer(ctx: HttpContext, parDefaut: string | null) {
    const { organizationId: demandee, ...payload } =
      await ctx.request.validateUsing(createDriverValidator)
    const organisation = await this.resoudreOrganisation(ctx, demandee, parDefaut)
    if (!organisation.ok) return organisation.reponse
    const organizationId = organisation.organizationId

    if (payload.vehicleId && !(await this.vehiculeValide(organizationId, payload.vehicleId))) {
      return this.vehiculeHorsPerimetre(ctx, payload.vehicleId)
    }

    const doublon = await this.identifiantPris(organizationId, payload)
    if (doublon) return this.identifiantDejaPris(ctx, doublon)

    const { licenseExpiresOn, ...champs } = payload
    const conducteur = await DriverModel.create({
      ...champs,
      organizationId,
      licenseCategories: payload.licenseCategories ?? [],
      licenseExpiresOn: licenseExpiresOn ? DateTime.fromISO(licenseExpiresOn) : null,
    })
    // `full_name` est générée par PostgreSQL : on relit la ligne pour l'exposer.
    await conducteur.refresh()

    await this.tracer(ctx, organizationId, 'created', conducteur.id, {
      after: this.resume(conducteur),
    })
    return ctx.response.created({ data: conducteur.serialize() })
  }

  /** Changement d'organisation (ajout, déplacement, retrait) et ses conséquences. */
  private async changerOrganisation(
    ctx: HttpContext,
    conducteur: DriverModel,
    cible: string | null
  ) {
    const precedente = conducteur.organizationId
    if (precedente === cible) {
      return ctx.response.ok({
        data: { ...conducteur.serialize(), unchanged: true, vehicleDetached: false, groupsLeft: 0 },
      })
    }

    // Permis et matricule doivent rester uniques dans le périmètre d'ARRIVÉE.
    const doublon = await this.identifiantPris(
      cible,
      { licenseNumber: conducteur.licenseNumber, employeeCode: conducteur.employeeCode },
      conducteur.id
    )
    if (doublon) return this.identifiantDejaPris(ctx, doublon)

    const avant = this.resume(conducteur)
    let vehiculeRetire = false
    if (
      conducteur.vehicleId &&
      (cible === null || !(await this.vehiculeValide(cible, conducteur.vehicleId)))
    ) {
      conducteur.vehicleId = null
      vehiculeRetire = true
    }
    conducteur.organizationId = cible
    await conducteur.save()
    const groupesQuittes = await this.groupes.pruneForeignMemberships(conducteur.id, cible)

    const metadata = { vehicleDetached: vehiculeRetire, groupsLeft: groupesQuittes }
    // Côté organisation QUITTÉE : le départ, sans révéler l'organisation d'arrivée.
    if (precedente) {
      await this.tracer(ctx, precedente, 'organization_removed', conducteur.id, {
        before: avant,
        after: { organizationId: null },
        metadata,
      })
    }
    // Côté organisation REJOINTE : l'arrivée.
    if (cible) {
      await this.tracer(ctx, cible, 'organization_assigned', conducteur.id, {
        before: { organizationId: null },
        after: this.resume(conducteur),
        metadata,
      })
    }

    const organisations = cible ? await organizationsOf([cible]) : {}
    return ctx.response.ok({
      data: {
        ...conducteur.serialize(),
        organization: cible ? (organisations[cible] ?? null) : null,
        vehicleDetached: vehiculeRetire,
        groupsLeft: groupesQuittes,
      },
    })
  }

  /** Groupes (vivants) d'un conducteur. */
  private async groupesDe(driverId: string) {
    const groupes = await DriverGroupModel.query()
      .join('driver_group_members as m', 'm.driver_group_id', 'driver_groups.id')
      .where('m.driver_id', driverId)
      .whereNull('driver_groups.deleted_at')
      .orderBy('driver_groups.name')
      .select('driver_groups.id', 'driver_groups.name', 'driver_groups.color', 'm.added_at')
    return groupes.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      addedAt: g.$extras.added_at ?? null,
    }))
  }

  /**
   * Trace sous la ressource GROUPE : elle apparaît ainsi dans le journal du
   * groupe (`/driver-groups/:id/audit-logs`), comme un ajout fait depuis
   * l'écran du groupe.
   */
  private tracerGroupe(
    ctx: HttpContext,
    conducteur: DriverModel,
    groupId: string,
    action: 'members_added' | 'members_removed'
  ) {
    const contexte = toExecutionContext(ctx)
    const detail = { driverIds: [conducteur.id] }
    return this.audit.record({
      context: {
        ...contexte,
        organizationId: conducteur.organizationId ?? contexte.organizationId,
      },
      action: `fleet.driver_group.${action}`,
      resourceType: 'driver_group',
      resourceId: groupId,
      ...(action === 'members_added' ? { after: detail } : { before: detail }),
      metadata: { from: 'driver' },
    })
  }

  /** Résumé des véhicules d'une page de conducteurs — une requête. */
  private async vehiculesDe(conducteurs: DriverModel[]) {
    const ids = [...new Set(conducteurs.map((c) => c.vehicleId).filter(Boolean))] as string[]
    if (ids.length === 0)
      return {} as Record<string, { id: string; registration: string; label: string | null }>
    const lignes = await VehicleModel.query()
      .whereIn('id', ids)
      .whereNull('deleted_at')
      .select('id', 'registration', 'label')
    return Object.fromEntries(
      lignes.map((v) => [v.id, { id: v.id, registration: v.registration, label: v.label }])
    )
  }

  /**
   * Le véhicule doit être vivant et appartenir à l'organisation DU CONDUCTEUR.
   * Conducteur sans organisation (exploitant seulement) : tout véhicule vivant.
   */
  private async vehiculeValide(organizationId: string | null, vehicleId: string): Promise<boolean> {
    const query = VehicleModel.query().where('id', vehicleId).whereNull('deleted_at').select('id')
    if (organizationId) query.where('organization_id', organizationId)
    return (await query.first()) !== null
  }

  /**
   * Organisation CIBLE d'une écriture, à partir de la requête :
   *   undefined → `parDefaut` ; null → aucune (joker `*` exigé) ;
   *   uuid → cette organisation, dans le périmètre de l'acteur, et existante.
   */
  private async resoudreOrganisation(
    ctx: HttpContext,
    demandee: string | null | undefined,
    parDefaut: string | null
  ): Promise<OrganisationResolue> {
    if (demandee === undefined) return { ok: true, organizationId: parDefaut }

    if (demandee === null) {
      const scope = await organizationScope(ctx)
      if (!scope.isPlatform) {
        throw new ForbiddenError(
          "Seule l'administration de la plateforme gère les conducteurs sans organisation",
          { organizationId: null }
        )
      }
      return { ok: true, organizationId: null }
    }

    // 403 si l'acteur vise une organisation qui n'est pas la sienne sans le joker `*`.
    await organizationScope(ctx, demandee)
    const existe = await OrganizationModel.query()
      .where('id', demandee)
      .whereNull('deleted_at')
      .select('id')
      .first()
    if (!existe) return { ok: false, reponse: notFoundInScope(ctx, 'Organisation') }
    return { ok: true, organizationId: demandee }
  }

  private vehiculeHorsPerimetre(ctx: HttpContext, vehicleId: string) {
    return ctx.response.unprocessableEntity({
      error: {
        code: 'E_VEHICLE_OUT_OF_SCOPE',
        message: "Véhicule introuvable dans l'organisation du conducteur",
        details: { vehicleId },
      },
    })
  }

  /**
   * Permis et matricule sont uniques par organisation (index de la migration
   * 018). Pré-vérifiés pour répondre un 409 explicite sans passer par une
   * violation de contrainte ; l'index reste le rempart en cas de course.
   */
  private async identifiantPris(
    organizationId: string | null,
    payload: { licenseNumber?: string | null; employeeCode?: string | null },
    exceptId?: string
  ): Promise<'licenseNumber' | 'employeeCode' | null> {
    for (const champ of ['licenseNumber', 'employeeCode'] as const) {
      const valeur = payload[champ]
      if (!valeur) continue
      // Le vivier sans organisation est un périmètre d'unicité à part (index NULLS NOT DISTINCT).
      const query = DriverModel.query()
        .whereNull('deleted_at')
        .where(champ === 'licenseNumber' ? 'license_number' : 'employee_code', valeur)
      if (organizationId) query.where('organization_id', organizationId)
      else query.whereNull('organization_id')
      if (exceptId) query.whereNot('id', exceptId)
      if (await query.first()) return champ
    }
    return null
  }

  private identifiantDejaPris(ctx: HttpContext, champ: 'licenseNumber' | 'employeeCode') {
    return ctx.response.conflict({
      error:
        champ === 'licenseNumber'
          ? {
              code: 'E_DRIVER_LICENSE_TAKEN',
              message:
                'Ce numéro de permis est déjà attribué à un conducteur de cette organisation',
              details: {},
            }
          : {
              code: 'E_DRIVER_EMPLOYEE_CODE_TAKEN',
              message: 'Ce matricule est déjà attribué à un conducteur de cette organisation',
              details: {},
            },
    })
  }

  /** Le conducteur est cherché DANS le périmètre de l'acteur. */
  private async trouver(ctx: HttpContext): Promise<DriverModel | null> {
    const scope = await organizationScope(ctx)
    const query = DriverModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    if (!scope.isPlatform) query.where('organization_id', scope.organizationId)
    return query.first()
  }

  private resume(c: DriverModel): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of AUDITED) {
      const v = c[k]
      out[k] = v instanceof DateTime ? v.toISODate() : (v ?? null)
    }
    return out
  }

  /** Conducteur sans organisation : tracé dans l'organisation de l'acteur (l'exploitant). */
  private tracer(
    ctx: HttpContext,
    organizationId: string | null,
    action: string,
    driverId: string,
    details: {
      before?: Record<string, unknown>
      after?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    const contexte = toExecutionContext(ctx)
    return this.audit.record({
      context: { ...contexte, organizationId: organizationId ?? contexte.organizationId },
      action: `fleet.driver.${action}`,
      resourceType: 'driver',
      resourceId: driverId,
      ...details,
    })
  }
}
