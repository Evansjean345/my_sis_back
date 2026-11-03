import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import VehicleModel from '#infrastructure/persistence/models/vehicle_model'
import { LucidVehicleLiveReader } from '#infrastructure/persistence/readers/vehicle_live_reader'
import {
  createVehicleValidator,
  updateVehicleValidator,
  listVehiclesValidator,
} from '#presentation/http/validators/fleet/fleet_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { liveFleetValidator } from '#presentation/http/validators/fleet/stats_validators'
import {
  adminListVehiclesValidator,
  adminOrganizationFilterValidator,
  targetOrganizationValidator,
} from '#presentation/http/validators/admin/admin_validators'
import {
  PLATFORM_SCOPE,
  applyScope,
  authorizePlatform,
  countsBy,
  organizationsOf,
  ownScope,
  serializeWithOrganizations,
  type TenantScope,
} from '#presentation/http/support/platform_scope'

/** Plafond de la carte temps réel : au-delà, c'est un export, pas une carte. */
/*
Mettre dans un fichier limite de véhicules affichées sur une carte
*/
const FLEET_LIVE_MAX = 1000

/**
 * =========================================================================
 *  CRUD FLOTTE — style PRAGMATIQUE
 * =========================================================================
 *
 * Contrôleur → Lucid, sans agrégat ni cas d'usage. Il n'y a ici aucune
 * invariant complexe à protéger : les règles structurelles sont déjà tenues
 * par la base (contraintes EXCLUDE sur les affectations, unicité de
 * l'immatriculation, CHECK sur les statuts).
 *
 * C'est la calibration décidée au Jalon 1 : profondeur des couches
 * proportionnelle à la richesse du domaine. Ajouter quatre fichiers pour un
 * `GET /vehicles` serait de la cérémonie.
 */
@inject()
export default class VehicleController {
  constructor(private readonly liveReader: LucidVehicleLiveReader) {}

  /** GET /api/v1/vehicles — cloisonné à l'organisation de l'acteur. */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const {
      page = 1,
      perPage = 25,
      search,
      status,
    } = await ctx.request.validateUsing(listVehiclesValidator)
    const org = toExecutionContext(ctx).organizationId

    const query = VehicleModel.query()
      .where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('registration')

    if (status) query.where('status', status)
    // pg_trgm est installé (migration 001) : la recherche floue sur
    // l'immatriculation reste indexée.
    if (search) query.whereILike('registration', `%${search}%`)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /**
   * GET /api/v1/vehicles/stats — indicateurs du parc de l'organisation.
   * Même contenu que `/admin/vehicles/stats`, cloisonné à l'acteur.
   */
  async stats(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return this.statistiques(ctx, ownScope(ctx))
  }

  /**
   * GET /api/v1/fleet/live?status=&vehicleGroupId=
   *
   * La flotte de l'organisation pour la carte temps réel, en DEUX requêtes
   * quel que soit le nombre de véhicules : la liste, puis boîtier monté et
   * dernière position de toute la page. Remplace « une requête détail par
   * véhicule » (N+1) côté front, qui plafonnait la carte à 100 véhicules.
   *
   * Chaque ligne a la forme de `GET /vehicles/:id` : le front n'a qu'un type.
   */
  /*
  Flotte d'une organisation en temps réel et retrouver un groupe de véhicule par son id
  fonction à utiliser pour optimiser le dashboard admin
  */
  async live(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    const { status, vehicleGroupId } = await ctx.request.validateUsing(liveFleetValidator)
    const org = toExecutionContext(ctx).organizationId

    const query = VehicleModel.query()
      .where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('registration')
      .limit(FLEET_LIVE_MAX) //utilisation de la limite
    if (status) query.where('status', status)
    else query.whereNot('status', 'archived')
    if (vehicleGroupId) {
      // Le groupe est croisé avec l'organisation : un groupe d'un autre client
      // ne sélectionne rien.
      query.whereExists((sub) =>
        sub
          .from('vehicle_group_members as m')
          .join('vehicle_groups as g', 'g.id', 'm.vehicle_group_id')
          .whereRaw('m.vehicle_id = vehicles.id')
          .where('g.id', vehicleGroupId)
          .where('g.organization_id', org)
          .whereNull('g.deleted_at')
      )
    }

    const vehicules = await query
    const details = await this.liveReader.detailsByVehicle(vehicules.map((v) => v.id))

    return ctx.response.ok({
      data: vehicules.map((v) => ({
        ...v.serialize(),
        ...(details[v.id] ?? { device: null, lastPosition: null }),
      })),
      meta: {
        total: vehicules.length,
        //valeur courcite
        truncated: vehicules.length === FLEET_LIVE_MAX,
        generatedAt: DateTime.now().toISO(),
      },
    })
  }

  /** GET /api/v1/vehicles/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewVehicles')
    return this.afficher(ctx, ownScope(ctx))
  }

  /** POST /api/v1/vehicles */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.creer(ctx, toExecutionContext(ctx).organizationId)
  }

  /** PATCH /api/v1/vehicles/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.modifier(ctx, ownScope(ctx))
  }

  /**
   * DELETE /api/v1/vehicles/:id — suppression LOGIQUE.
   *
   * Le véhicule est référencé par des positions, des trajets et des alertes qui
   * doivent rester lisibles. Une suppression physique casserait l'historique.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageVehicles')
    return this.archiver(ctx, ownScope(ctx))
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /** GET /api/v1/admin/vehicles ?organizationId=&status=&search=&page=&perPage= */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const {
      page = 1,
      perPage = 25,
      search,
      status,
      organizationId,
    } = await ctx.request.validateUsing(adminListVehiclesValidator)

    const query = VehicleModel.query().whereNull('deleted_at').orderBy('registration')
    if (organizationId) query.where('organization_id', organizationId)
    if (status) query.where('status', status)
    if (search) query.whereILike('registration', `%${search}%`)

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(await serializeWithOrganizations(resultat))
  }

  /**
   * GET /api/v1/admin/vehicles/stats?organizationId=
   *
   * Parc par statut, par organisation, et état de connexion issu de
   * `vehicle_last_positions` (online / idle / offline / never_seen).
   */
  async statsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(adminOrganizationFilterValidator)
    return this.statistiques(ctx, { organizationId: organizationId ?? null })
  }

  /** GET /api/v1/admin/vehicles/:id */
  async showAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.afficher(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/vehicles — body : { organizationId, ...champs de POST /vehicles } */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(targetOrganizationValidator)

    const organisation = await OrganizationModel.query()
      .where('id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    if (!organisation) return this.introuvable(ctx, 'Organisation')

    return this.creer(ctx, organizationId)
  }

  /** PATCH /api/v1/admin/vehicles/:id */
  async updateAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.modifier(ctx, PLATFORM_SCOPE)
  }

  /** DELETE /api/v1/admin/vehicles/:id — suppression logique. */
  async destroyAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.archiver(ctx, PLATFORM_SCOPE)
  }

  // -------------------------------------------------------------------------
  //  Implémentations partagées client / admin : seul le périmètre change.
  // -------------------------------------------------------------------------

  /**
   * Parc par statut, par organisation, et état de connexion issu de
   * `vehicle_last_positions` (online / idle / offline / never_seen).
   */
  private async statistiques(ctx: HttpContext, scope: TenantScope) {
    // Colonnes qualifiées : la répartition par connexion joint `vehicle_last_positions`,
    // qui porte aussi `organization_id` (sinon « column reference is ambiguous »).
    const base = () =>
      applyScope(
        VehicleModel.query().whereNull('vehicles.deleted_at'),
        scope,
        'vehicles.organization_id'
      )

    const [parStatut, parOrganisation, parConnexion, equipes] = await Promise.all([
      base().select('status').count('* as total').groupBy('status'),
      base().select('organization_id').count('* as total').groupBy('organization_id'),
      this.liveReader.countByConnection(scope.organizationId),
      base()
        .whereExists((sub) =>
          sub
            .from('device_assignments as da')
            .whereRaw('da.vehicle_id = vehicles.id')
            .whereRaw('upper_inf(da.period)')
        )
        .count('* as total')
        .first(),
    ])

    const compteurs = countsBy(parStatut, 'status')
    const organisations = await organizationsOf(parOrganisation.map((l) => l.organizationId))
    const total = Object.values(compteurs).reduce((a, b) => a + b, 0)
    const avecBoitier = Number(equipes?.$extras.total ?? 0)

    return ctx.response.ok({
      data: {
        total,
        withDevice: avecBoitier,
        withoutDevice: total - avecBoitier,
        byStatus: compteurs,
        byConnection: parConnexion,
        byOrganization: parOrganisation.map((l) => ({
          organization: organisations[l.organizationId] ?? { id: l.organizationId },
          total: Number(l.$extras.total ?? 0),
        })),
      },
    })
  }

  /*
  Afficher tous les véhicules d'une organisation , les boitiers montés sur un véhicule
  et leur derniere position
  */
  private async afficher(ctx: HttpContext, scope: TenantScope) {
    const vehicule = await this.trouver(ctx, scope)
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    // Boîtier actuellement monté + dernière position connue.
    const { device, lastPosition } = await this.liveReader.detail(vehicule.id)
    const organisations = await organizationsOf([vehicule.organizationId])

    return ctx.response.ok({
      data: {
        ...vehicule.serialize(),
        organization: organisations[vehicule.organizationId] ?? null,
        device,
        lastPosition,
      },
    })
  }

  /*
  Fonction utilitaire pour créer un véhicule
  */
  private async creer(ctx: HttpContext, organizationId: string) {
    const payload = await ctx.request.validateUsing(createVehicleValidator)

    const vehicule = await VehicleModel.create({
      ...payload,
      registration: `sisbm${payload.registration}`,
      organizationId,
      status: payload.status ?? 'active',
      odometerKm: payload.odometerKm ?? 0,
      immobilizationEnabled: payload.immobilizationEnabled ?? false,
    })
    return ctx.response.created({ data: vehicule.serialize() })
  }

  /*
  Fonction utilitaire pour modifier le statut un véhicule / status = payload.status
  */
  private async modifier(ctx: HttpContext, scope: TenantScope) {
    const payload = await ctx.request.validateUsing(updateVehicleValidator)
    const vehicule = await this.trouver(ctx, scope)
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    vehicule.merge(payload)
    await vehicule.save()
    return ctx.response.ok({ data: vehicule.serialize() })
  }

  /*
  Fonction utilitaire pour archiver un véhicule / status = archived
  */
  private async archiver(ctx: HttpContext, scope: TenantScope) {
    const vehicule = await this.trouver(ctx, scope)
    if (!vehicule) return this.introuvable(ctx, 'Véhicule')

    vehicule.deletedAt = DateTime.now()
    vehicule.status = 'archived'
    await vehicule.save()
    return ctx.response.noContent()
  }

  /** Cherché DANS le périmètre : un id d'un autre client donne 404, pas une fuite. */
  /*
  Fonction utilitaire pour retrouvé un vehicule
  */
  private trouver(ctx: HttpContext, scope: TenantScope): Promise<VehicleModel | null> {
    const query = VehicleModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    return applyScope(query, scope).first()
  }

  /*
  Fonction utilitaire NOT_FOUND
  */
  private introuvable(ctx: HttpContext, ressource: string) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: `${ressource} introuvable`, details: {} },
    })
  }
}
