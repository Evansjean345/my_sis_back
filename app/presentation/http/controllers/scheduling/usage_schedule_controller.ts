import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import type { DomainError } from '#domain/kernel'
import {
  ANALYTICS_MAX_DAYS,
  DEFAULT_SCHEDULE_TIMEZONE,
} from '#domain/scheduling/code_legacy/schedule/schedule_limits'
import { assertTimeZone, validateWeeklyWindows } from '#domain/scheduling/value_objects'
import { resolveUsage } from '#domain/scheduling/usage_policy'
import UsageScheduleModel from '#infrastructure/persistence/models/usage_schedule_model'
import VehicleGroupModel from '#infrastructure/persistence/models/vehicle_group_model'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { LucidUsageScheduleRepository } from '#infrastructure/persistence/repositories/usage_schedule_repository'
import { LucidEnforcementReader } from '#infrastructure/persistence/readers/schedule_enforcement_reader'
import { LucidScheduleAnalyticsReader } from '#infrastructure/persistence/readers/schedule_analytics_reader'
import { InvalidAnalyticsRangeError } from '#domain/scheduling/errors'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import type { AssignmentChange } from '#application/scheduling/ports'
import {
  adminListUsageSchedulesValidator,
  adminScheduleAnalyticsValidator,
  scheduleAnalyticsValidator,
  attachScheduleGroupsValidator,
  attachScheduleVehiclesValidator,
  createUsageScheduleValidator,
  listUsageSchedulesValidator,
  replaceWindowsValidator,
  updateUsageScheduleValidator,
} from '#presentation/http/validators/scheduling/schedule_validators'
import { targetOrganizationValidator } from '#presentation/http/validators/admin/admin_validators'
import { authorize } from '#presentation/http/support/authorize'
import { organizationScope } from '#presentation/http/support/organization_scope'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform, organizationsOf } from '#presentation/http/support/platform_scope'
import { notFoundInScope, vehicleInScope } from '#presentation/http/support/tenant_resources'

/**
 * =========================================================================
 *  CALENDRIERS D'UTILISATION — administration et immobilisation planifiée
 * =========================================================================
 *
 * Un calendrier = un fuseau + des plages hebdomadaires AUTORISÉES. Rattaché
 * à des véhicules (`vehicle_schedules`) et/ou à des flottes
 * (`vehicle_schedule_groups`) : le véhicule ne roule que pendant les plages.
 *
 * Le moteur `node ace sisbm:schedules:enforce` coupe AUTOMATIQUEMENT le
 * moteur d'un véhicule hors de ses plages, en passant par les mêmes
 * garde-fous que l'opérateur (vitesse CM-07 compris). Ce contrôleur ne coupe
 * aucun moteur : il administre, et il expose l'état (`vehicleStatus`).
 *
 * Style pragmatique pour le CRUD (contrôleur → Lucid), port de dépôt pour
 * ce qui porte une règle : écriture atomique des plages, cloisonnement des
 * rattachements.
 */
@inject()
export default class UsageScheduleController {
  constructor(
    private readonly schedules: LucidUsageScheduleRepository,
    private readonly reader: LucidEnforcementReader,
    private readonly audit: LucidAuditLogger,
    private readonly analyticsReader: LucidScheduleAnalyticsReader
  ) {}

  /**
   * GET /usage-schedules/analytics ?from=AAAA-MM-JJ&to=AAAA-MM-JJ&timezone=
   *
   * Historique RÉEL de l'immobilisation planifiée dans l'organisation :
   * commandes émises et leur issue, refus avant émission (motif),
   * délais d'exécution — par jour, par heure, par calendrier, par véhicule.
   */
  async analytics(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const scope = await organizationScope(ctx, ctx.params.organizationId)
    const f = await ctx.request.validateUsing(scheduleAnalyticsValidator)
    return this.analyser(ctx, [scope.organizationId], f)
  }

  /** GET /admin/usage-schedules/analytics ?organizationId= (facultatif : toutes) */
  async analyticsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(adminScheduleAnalyticsValidator)
    return this.analyser(ctx, f.organizationId ? [f.organizationId] : [], f)
  }

  private async analyser(
    ctx: HttpContext,
    organizationIds: string[],
    f: { from: string; to: string; timezone?: string }
  ) {
    const fuseau = assertTimeZone(f.timezone ?? DEFAULT_SCHEDULE_TIMEZONE)
    if (!fuseau.ok) return this.echec(ctx, fuseau.error)

    const debut = DateTime.fromISO(f.from, { zone: fuseau.value })
    const fin = DateTime.fromISO(f.to, { zone: fuseau.value })
    const jours = fin.diff(debut, 'days').days + 1
    if (!debut.isValid || !fin.isValid || jours < 1 || jours > ANALYTICS_MAX_DAYS) {
      return this.echec(ctx, new InvalidAnalyticsRangeError(f.from, f.to, ANALYTICS_MAX_DAYS))
    }

    const data = await this.analyticsReader.analyze({
      organizationIds,
      from: f.from,
      to: f.to,
      timezone: fuseau.value,
    })
    return ctx.response.ok({ data })
  }

  /** GET /usage-schedules ?search=&isActive=&page=&perPage= */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const scope = await organizationScope(ctx, ctx.params.organizationId)
    const filtres = await ctx.request.validateUsing(listUsageSchedulesValidator)

    const query = UsageScheduleModel.query()
      .where('organization_id', scope.organizationId)
      .whereNull('deleted_at')
      .orderBy('name')
    if (filtres.search) query.whereILike('name', `%${filtres.search}%`)
    if (filtres.isActive !== undefined) query.where('is_active', filtres.isActive)

    const page = await query.paginate(filtres.page ?? 1, Math.min(filtres.perPage ?? 25, 100))
    return ctx.response.ok({ meta: page.getMeta(), data: await this.enrichir(page.all()) })
  }

  /** POST /usage-schedules — body : { name, timezone?, isActive?, description?, windows? } */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const scope = await organizationScope(ctx, ctx.params.organizationId)
    return this.creer(ctx, scope.organizationId)
  }

  /** GET /usage-schedules/:id — calendrier, plages, véhicules et groupes rattachés. */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    const [plages, vehicules, groupes] = await Promise.all([
      this.schedules.windowsOf([calendrier.id]),
      this.schedules.vehiclesOf(calendrier.id),
      this.schedules.groupsOf(calendrier.id),
    ])
    return ctx.response.ok({
      data: {
        ...calendrier.serialize(),
        windows: plages[calendrier.id] ?? [],
        vehicles: vehicules,
        vehicleGroups: groupes,
      },
    })
  }

  /** PATCH /usage-schedules/:id — `windows`, s'il est fourni, remplace toute la semaine. */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const payload = await ctx.request.validateUsing(updateUsageScheduleValidator)
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    if (payload.timezone) {
      const tz = assertTimeZone(payload.timezone)
      if (!tz.ok) return this.echec(ctx, tz.error)
    }
    const { windows, ...champs } = payload
    const plages = windows ? validateWeeklyWindows(windows) : null
    if (plages && !plages.ok) return this.echec(ctx, plages.error)

    if (payload.name && payload.name.toLowerCase() !== calendrier.name.toLowerCase()) {
      if (await this.nomPris(calendrier.organizationId, payload.name, calendrier.id)) {
        return this.nomDejaPris(ctx, payload.name)
      }
    }

    const avant = this.resume(calendrier)
    calendrier.merge(champs)
    await calendrier.save()
    if (plages?.ok) await this.schedules.replaceWindows(calendrier.id, plages.value)

    await this.tracer(ctx, calendrier.organizationId, 'updated', calendrier.id, {
      before: avant,
      after: {
        ...this.resume(calendrier),
        ...(plages?.ok ? { windows: plages.value.map((w) => w.toJSON()) } : {}),
      },
    })
    const fenetres = await this.schedules.windowsOf([calendrier.id])
    return ctx.response.ok({
      data: { ...calendrier.serialize(), windows: fenetres[calendrier.id] ?? [] },
    })
  }

  /**
   * DELETE /usage-schedules/:id — suppression LOGIQUE.
   *
   * Le moteur cesse d'appliquer le calendrier au passage suivant. Les
   * véhicules qu'IL avait immobilisés sont rétablis (s'ils ne relèvent pas
   * d'un autre calendrier) ; une coupure manuelle (vol) reste en place.
   */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    calendrier.deletedAt = DateTime.now()
    await calendrier.save()
    await this.tracer(ctx, calendrier.organizationId, 'deleted', calendrier.id, {
      before: this.resume(calendrier),
    })
    return ctx.response.noContent()
  }

  /** PUT /usage-schedules/:id/windows — body : { windows: [{ dayOfWeek, startTime, endTime }] } */
  async replaceWindows(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const { windows } = await ctx.request.validateUsing(replaceWindowsValidator)
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    const plages = validateWeeklyWindows(windows)
    if (!plages.ok) return this.echec(ctx, plages.error)

    const existantes = await this.schedules.windowsOf([calendrier.id])
    const avant = existantes[calendrier.id] ?? []
    await this.schedules.replaceWindows(calendrier.id, plages.value)
    await this.tracer(ctx, calendrier.organizationId, 'windows_replaced', calendrier.id, {
      before: { windows: avant.map(({ id: _id, ...w }) => w) },
      after: { windows: plages.value.map((w) => w.toJSON()) },
    })

    const apres = await this.schedules.windowsOf([calendrier.id])
    return ctx.response.ok({ data: apres[calendrier.id] ?? [] })
  }

  // ---------------------------------------------------------------- véhicules

  /** GET /usage-schedules/:id/vehicles */
  async vehicles(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')
    const data = await this.schedules.vehiclesOf(calendrier.id)
    return ctx.response.ok({ data, meta: { total: data.length } })
  }

  /** POST /usage-schedules/:id/vehicles — body : { vehicleIds } (idempotent) */
  async attachVehicles(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const { vehicleIds } = await ctx.request.validateUsing(attachScheduleVehiclesValidator)
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    const r = await this.schedules.attachVehicles(
      calendrier.id,
      calendrier.organizationId,
      vehicleIds
    )
    return this.repondreRattachement(ctx, calendrier, r, 'vehicles', 'véhicule')
  }

  /** DELETE /usage-schedules/:id/vehicles/:memberId */
  async detachVehicle(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    if (!(await this.schedules.detachVehicle(calendrier.id, ctx.params.memberId))) {
      return notFoundInScope(ctx, 'Rattachement')
    }
    await this.tracer(ctx, calendrier.organizationId, 'vehicle_detached', calendrier.id, {
      before: { vehicleId: ctx.params.memberId },
    })
    return ctx.response.noContent()
  }

  // ---------------------------------------------------------------- groupes

  /** GET /usage-schedules/:id/vehicle-groups */
  async groups(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')
    const data = await this.schedules.groupsOf(calendrier.id)
    return ctx.response.ok({ data, meta: { total: data.length } })
  }

  /**
   * POST /usage-schedules/:id/vehicle-groups — body : { vehicleGroupIds }
   *
   * Immobilisation contrôlée d'une FLOTTE : tous ses véhicules, présents et
   * futurs, suivent le calendrier.
   */
  async attachGroups(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const { vehicleGroupIds } = await ctx.request.validateUsing(attachScheduleGroupsValidator)
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    const r = await this.schedules.attachGroups(
      calendrier.id,
      calendrier.organizationId,
      vehicleGroupIds
    )
    return this.repondreRattachement(ctx, calendrier, r, 'groups', 'groupe de véhicules')
  }

  /** DELETE /usage-schedules/:id/vehicle-groups/:memberId */
  async detachGroup(ctx: HttpContext) {
    await authorize(ctx, 'manageSchedules')
    const calendrier = await this.trouver(ctx)
    if (!calendrier) return notFoundInScope(ctx, 'Calendrier')

    if (!(await this.schedules.detachGroup(calendrier.id, ctx.params.memberId))) {
      return notFoundInScope(ctx, 'Rattachement')
    }
    await this.tracer(ctx, calendrier.organizationId, 'group_detached', calendrier.id, {
      before: { vehicleGroupId: ctx.params.memberId },
    })
    return ctx.response.noContent()
  }

  // ---------------------------------------------------------------- état

  /**
   * GET /vehicles/:id/schedule-status
   *
   * Pour comprendre une coupure automatique : calendriers applicables et leur
   * origine, verdict actuel, mémoire du moteur, dernière commande moteur
   * confirmée. Lecture seule.
   */
  async vehicleStatus(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const vehicule = await vehicleInScope(ctx, ctx.params.id)
    if (!vehicule) return notFoundInScope(ctx, 'Véhicule')

    const [cible] = await this.reader.listTargets({ vehicleIds: [vehicule.id] })
    const now = new Date()
    if (!cible) {
      return ctx.response.ok({
        data: {
          vehicleId: vehicule.id,
          managed: false,
          schedules: [],
          verdict: { state: 'free', cause: 'no_schedule', schedule: null },
          enforcement: null,
          lastConfirmedEngineCommand: null,
          evaluatedAt: now,
        },
      })
    }

    const verdict = resolveUsage(cible.assignments, now)

    return ctx.response.ok({
      data: {
        vehicleId: cible.vehicleId,
        registration: cible.registration,
        managed: true,
        schedules: cible.assignments.map((a) => ({
          id: a.scheduleId,
          name: a.scheduleName,
          timezone: a.timezone,
          source: a.source,
          windows: a.windows.map((w) => w.toJSON()),
        })),
        verdict: {
          state: verdict.state,
          cause: verdict.cause,
          schedule: verdict.decisive
            ? { id: verdict.decisive.scheduleId, name: verdict.decisive.scheduleName }
            : null,
        },
        enforcement: {
          stored: cible.state,
          commandInFlight: cible.commandInFlight,
        },
        lastConfirmedEngineCommand: cible.lastConfirmed,
        evaluatedAt: now,
      },
    })
  }

  /** GET /vehicle-groups/:id/schedules — calendriers appliqués à un groupe. */
  async groupSchedules(ctx: HttpContext) {
    await authorize(ctx, 'viewSchedules')
    const scope = await organizationScope(ctx)
    const query = VehicleGroupModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    if (!scope.isPlatform) query.where('organization_id', scope.organizationId)
    const groupe = await query.first()
    if (!groupe) return notFoundInScope(ctx, 'Groupe')

    const data = await this.schedules.schedulesOfGroup(groupe.id)
    return ctx.response.ok({ data, meta: { total: data.length } })
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /** GET /admin/usage-schedules ?organizationId=&search=&isActive=&page=&perPage= */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(adminListUsageSchedulesValidator)

    const query = UsageScheduleModel.query().whereNull('deleted_at').orderBy('name')
    if (f.organizationId) query.where('organization_id', f.organizationId)
    if (f.search) query.whereILike('name', `%${f.search}%`)
    if (f.isActive !== undefined) query.where('is_active', f.isActive)

    const page = await query.paginate(f.page ?? 1, Math.min(f.perPage ?? 25, 100))
    const lignes = page.all()
    const [data, organisations] = await Promise.all([
      this.enrichir(lignes),
      organizationsOf(lignes.map((l) => l.organizationId)),
    ])
    return ctx.response.ok({
      meta: page.getMeta(),
      data: data.map((d) => ({ ...d, organization: organisations[d.organizationId] ?? null })),
    })
  }

  /** POST /admin/usage-schedules — body : { organizationId, name, ... } */
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

  private async creer(ctx: HttpContext, organizationId: string) {
    const payload = await ctx.request.validateUsing(createUsageScheduleValidator)

    const tz = assertTimeZone(payload.timezone ?? DEFAULT_SCHEDULE_TIMEZONE)
    if (!tz.ok) return this.echec(ctx, tz.error)
    const plages = validateWeeklyWindows(payload.windows ?? [])
    if (!plages.ok) return this.echec(ctx, plages.error)
    if (await this.nomPris(organizationId, payload.name)) return this.nomDejaPris(ctx, payload.name)

    const id = await this.schedules.create({
      organizationId,
      name: payload.name,
      description: payload.description ?? null,
      timezone: tz.value,
      isActive: payload.isActive ?? true,
      windows: plages.value,
    })
    const calendrier = await UsageScheduleModel.findOrFail(id)

    await this.tracer(ctx, organizationId, 'created', id, {
      after: { ...this.resume(calendrier), windows: plages.value.map((w) => w.toJSON()) },
    })
    const fenetres = await this.schedules.windowsOf([id])
    return ctx.response.created({
      data: {
        ...calendrier.serialize(),
        windows: fenetres[id] ?? [],
        vehiclesCount: 0,
        vehicleGroupsCount: 0,
      },
    })
  }

  /** Plages et effectifs de toute une page en trois requêtes. */
  private async enrichir(lignes: UsageScheduleModel[]) {
    const ids = lignes.map((l) => l.id)
    const [plages, effectifs] = await Promise.all([
      this.schedules.windowsOf(ids),
      this.schedules.countTargets(ids),
    ])
    return lignes.map((l) => ({
      ...l.serialize(),
      organizationId: l.organizationId,
      windows: plages[l.id] ?? [],
      vehiclesCount: effectifs[l.id]?.vehicles ?? 0,
      vehicleGroupsCount: effectifs[l.id]?.groups ?? 0,
    }))
  }

  private async repondreRattachement(
    ctx: HttpContext,
    calendrier: UsageScheduleModel,
    r: AssignmentChange,
    famille: 'vehicles' | 'groups',
    libelle: string
  ) {
    if (r.applied.length > 0) {
      await this.tracer(ctx, calendrier.organizationId, `${famille}_attached`, calendrier.id, {
        after: { applied: r.applied },
        metadata: { rejected: r.rejected.length },
      })
    }
    if (r.applied.length + r.unchanged.length === 0) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_TARGETS_OUT_OF_SCOPE',
          message: `Aucun ${libelle} exploitable : identifiants inconnus, supprimés ou hors de l'organisation du calendrier`,
          details: { rejected: r.rejected },
        },
      })
    }
    return ctx.response.ok({ data: r })
  }

  /** Le calendrier est cherché DANS le périmètre de l'acteur : pas de fuite inter-clients. */
  private async trouver(ctx: HttpContext): Promise<UsageScheduleModel | null> {
    const scope = await organizationScope(ctx)
    const query = UsageScheduleModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    if (!scope.isPlatform) query.where('organization_id', scope.organizationId)
    return query.first()
  }

  private async nomPris(organizationId: string, name: string, exceptId?: string) {
    const query = UsageScheduleModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .whereRaw('lower(name) = lower(?)', [name])
    if (exceptId) query.whereNot('id', exceptId)
    return (await query.first()) !== null
  }

  private nomDejaPris(ctx: HttpContext, name: string) {
    return ctx.response.conflict({
      error: {
        code: 'E_SCHEDULE_NAME_TAKEN',
        message: `Un calendrier nommé « ${name} » existe déjà dans cette organisation`,
        details: { name },
      },
    })
  }

  private resume(c: UsageScheduleModel) {
    return {
      name: c.name,
      description: c.description,
      timezone: c.timezone,
      isActive: c.isActive,
    }
  }

  private echec(ctx: HttpContext, error: DomainError) {
    return ctx.response.status(error.httpStatus).send({ error: error.toJSON() })
  }

  private tracer(
    ctx: HttpContext,
    organizationId: string,
    action: string,
    scheduleId: string,
    details: {
      before?: Record<string, unknown>
      after?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    return this.audit.record({
      context: { ...toExecutionContext(ctx), organizationId },
      action: `scheduling.usage_schedule.${action}`,
      resourceType: 'usage_schedule',
      resourceId: scheduleId,
      ...details,
    })
  }
}
