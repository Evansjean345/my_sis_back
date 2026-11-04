import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import DriverModel from '#infrastructure/persistence/models/driver_model'
import DriverGroupModel from '#infrastructure/persistence/models/driver_group_model'
import VehicleModel from '#infrastructure/persistence/models/vehicle_model'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  adminListDriversValidator,
  assignDriverVehicleValidator,
  createDriverValidator,
  listDriversValidator,
  updateDriverValidator,
} from '#presentation/http/validators/fleet/driver_validators'
import { targetOrganizationValidator } from '#presentation/http/validators/admin/admin_validators'
import { authorize } from '#presentation/http/support/authorize'
import { organizationScope } from '#presentation/http/support/organization_scope'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform, organizationsOf } from '#presentation/http/support/platform_scope'
import { notFoundInScope, vehicleInScope } from '#presentation/http/support/tenant_resources'

/** Champs suivis dans l'audit (avant / après). */
const AUDITED = [
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
}

/**
 * =========================================================================
 *  CONDUCTEURS — style PRAGMATIQUE (contrôleur → Lucid)
 * =========================================================================
 *
 * Un conducteur appartient à une organisation et peut être rattaché à un
 * véhicule de CETTE organisation. Les invariants structurels sont tenus par
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
  constructor(private readonly audit: LucidAuditLogger) {}

  /** GET /drivers ?search=&status=&vehicleId=&driverGroupId=&unassigned=&page=&perPage= */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const scope = await organizationScope(ctx)
    const filtres = await ctx.request.validateUsing(listDriversValidator)
    return this.lister(ctx, filtres, scope.organizationId)
  }

  /** POST /drivers */
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
      DriverGroupModel.query()
        .join('driver_group_members as m', 'm.driver_group_id', 'driver_groups.id')
        .where('m.driver_id', conducteur.id)
        .whereNull('driver_groups.deleted_at')
        .orderBy('driver_groups.name')
        .select('driver_groups.id', 'driver_groups.name', 'driver_groups.color'),
    ])
    return ctx.response.ok({
      data: {
        ...conducteur.serialize(),
        vehicle: conducteur.vehicleId ? (vehicules[conducteur.vehicleId] ?? null) : null,
        groups: groupes.map((g) => ({ id: g.id, name: g.name, color: g.color })),
      },
    })
  }

  /** PATCH /drivers/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    const payload = await ctx.request.validateUsing(updateDriverValidator)
    const conducteur = await this.trouver(ctx)
    if (!conducteur) return notFoundInScope(ctx, 'Conducteur')

    if (
      payload.vehicleId &&
      !(await this.vehiculeValide(conducteur.organizationId, payload.vehicleId))
    ) {
      return this.vehiculeHorsPerimetre(ctx, payload.vehicleId)
    }

    const doublon = await this.identifiantPris(conducteur.organizationId, payload, conducteur.id)
    if (doublon) return this.identifiantDejaPris(ctx, doublon)

    const avant = this.resume(conducteur)
    const { licenseExpiresOn, ...champs } = payload
    conducteur.merge(champs)
    if (licenseExpiresOn !== undefined) {
      conducteur.licenseExpiresOn = licenseExpiresOn ? DateTime.fromISO(licenseExpiresOn) : null
    }
    await conducteur.save()
    await conducteur.refresh()

    await this.tracer(ctx, conducteur.organizationId, 'updated', conducteur.id, {
      before: avant,
      after: this.resume(conducteur),
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
      .where('organization_id', vehicule.organizationId)
      .whereNull('deleted_at')
      .orderBy('full_name')
    return ctx.response.ok({
      data: conducteurs.map((c) => c.serialize()),
      meta: { total: conducteurs.length },
    })
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /** GET /admin/drivers ?organizationId=&… */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId, ...filtres } =
      await ctx.request.validateUsing(adminListDriversValidator)
    return this.lister(ctx, filtres, organizationId ?? null, true)
  }

  /** POST /admin/drivers — body : { organizationId, firstName, lastName, … } */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(targetOrganizationValidator)
    const existe = await OrganizationModel.query()
      .where('id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    if (!existe) return notFoundInScope(ctx, 'Organisation')
    return this.creer(ctx, organizationId)
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
      avecOrganisation ? organizationsOf(lignes.map((l) => l.organizationId)) : Promise.resolve({}),
    ])

    return ctx.response.ok({
      meta: page.getMeta(),
      data: lignes.map((c) => ({
        ...c.serialize(),
        vehicle: c.vehicleId ? (vehicules[c.vehicleId] ?? null) : null,
        ...(avecOrganisation
          ? { organization: (organisations as Record<string, unknown>)[c.organizationId] ?? null }
          : {}),
      })),
    })
  }

  private async creer(ctx: HttpContext, organizationId: string) {
    const payload = await ctx.request.validateUsing(createDriverValidator)

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

  /** Le véhicule doit être vivant et appartenir à l'organisation DU CONDUCTEUR. */
  private async vehiculeValide(organizationId: string, vehicleId: string): Promise<boolean> {
    const v = await VehicleModel.query()
      .where('id', vehicleId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return v !== null
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
    organizationId: string,
    payload: { licenseNumber?: string | null; employeeCode?: string | null },
    exceptId?: string
  ): Promise<'licenseNumber' | 'employeeCode' | null> {
    for (const champ of ['licenseNumber', 'employeeCode'] as const) {
      const valeur = payload[champ]
      if (!valeur) continue
      const query = DriverModel.query()
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .where(champ === 'licenseNumber' ? 'license_number' : 'employee_code', valeur)
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

  private tracer(
    ctx: HttpContext,
    organizationId: string,
    action: string,
    driverId: string,
    details: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ) {
    return this.audit.record({
      context: { ...toExecutionContext(ctx), organizationId },
      action: `fleet.driver.${action}`,
      resourceType: 'driver',
      resourceId: driverId,
      ...details,
    })
  }
}
