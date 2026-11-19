import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import OfferModel from '#infrastructure/persistence/models/offer_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  activationProblem,
  normalizeFeatures,
  OFFER_FEATURES,
  pathsOf,
} from '#domain/billing/offer_policy'
import {
  attachOfferOrganizationsValidator,
  createOfferValidator,
  listOffersValidator,
  updateOfferValidator,
} from '#presentation/http/validators/billing/offer_validators'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform } from '#presentation/http/support/platform_scope'

/** Champs tracés avant / après dans le journal d'audit. */
const AUDITED = [
  'code',
  'name',
  'description',
  'price',
  'currency',
  'periodicity',
  'status',
  'launchedOn',
  'maxVehicles',
  'gpsHistoryDays',
  'features',
] as const

/** Organisation détentrice d'une offre, telle qu'exposée. */
interface Holder {
  id: string
  code: string
  name: string
  isActive: boolean
  assignedAt: string
}

/** Résultat d'un rattachement : ce qui a été fait, ou pourquoi c'est refusé. */
type Attachment =
  | { ok: true; attached: string[]; moved: { organizationId: string; fromOfferId: string }[] }
  | { ok: false; missing: string[] }
  | {
      ok: false
      conflicts: { organizationId: string; offer: { id: string; code: string; name: string } }[]
    }

/**
 * =========================================================================
 *  OFFRES COMMERCIALES — routes `/api/v1/admin/offers/*` (plateforme)
 * =========================================================================
 *
 * Réservées à l'exploitant (joker `*`) : ni un administrateur ni un
 * opérateur d'organisation ne voient le catalogue.
 *
 * Une offre est partagée par PLUSIEURS organisations (table
 * `offer_organizations`, migration 023) ; une organisation ne détient
 * qu'UNE offre à la fois. Rattacher une organisation qui en détient déjà une
 * autre répond 409, sauf avec `move: true`, qui la déplace.
 *
 * Chaque écriture est auditée (`billing.offer.*`). Les rattachements et
 * retraits sont tracés une fois PAR organisation, sous cette organisation :
 * chacune retrouve dans son propre journal les changements de son offre.
 */
@inject()
export default class OfferController {
  constructor(private readonly audit: LucidAuditLogger) {}

  /** GET /admin/offers/features — catalogue des fonctionnalités vendables. */
  async features(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return ctx.response.ok({ data: OFFER_FEATURES })
  }

  /** GET /admin/offers ?search=&status=&periodicity=&organizationId=&assigned=&page=&perPage= */
  async index(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(listOffersValidator)

    const query = OfferModel.query().whereNull('deleted_at').orderBy('name')
    if (f.status) query.where('status', f.status)
    if (f.periodicity) query.where('periodicity', f.periodicity)
    const liens = (q: any) => q.from('offer_organizations').whereColumn('offer_id', 'offers.id')
    if (f.organizationId) {
      query.whereExists((q) => liens(q).where('organization_id', f.organizationId!))
    }
    if (f.assigned === true) query.whereExists(liens)
    if (f.assigned === false) query.whereNotExists(liens)
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) => q.whereILike('name', motif).orWhereILike('code', motif))
    }

    const page = await query.paginate(f.page ?? 1, Math.min(f.perPage ?? 25, 100))
    const lignes = page.all()
    const detenteurs = await this.detenteurs(lignes.map((o) => o.id))
    return ctx.response.ok({
      meta: page.getMeta(),
      data: lignes.map((o) => this.exposer(o, detenteurs.get(o.id) ?? [])),
    })
  }

  /** GET /admin/offers/:id — avec ses organisations et leur nombre de véhicules (quota). */
  async show(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)
    return ctx.response.ok({ data: await this.detailler(offre) })
  }

  /** POST /admin/offers — `organizationIds` facultatif. */
  async store(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { launchedOn, organizationIds, features, ...champs } =
      await ctx.request.validateUsing(createOfferValidator)

    const statut = champs.status ?? 'inactive'
    const probleme = activationProblem({ status: statut, launchedOn: launchedOn ?? null })
    if (probleme) return this.regleMetier(ctx, 'E_OFFER_LAUNCH_DATE_REQUIRED', probleme)
    if (await this.codePris(champs.code)) return this.codeDejaPris(ctx, champs.code)

    const trx = await db.transaction()
    let offre: OfferModel
    let rattachement: Attachment = { ok: true, attached: [], moved: [] }
    try {
      offre = await OfferModel.create(
        {
          ...champs,
          description: champs.description ?? null,
          price: String(champs.price),
          status: statut,
          launchedOn: launchedOn ? DateTime.fromISO(launchedOn) : null,
          maxVehicles: champs.maxVehicles ?? null,
          features: normalizeFeatures(features ?? []),
        },
        { client: trx }
      )
      if (organizationIds?.length) {
        rattachement = await this.rattacher(trx, offre.id, organizationIds, false, ctx)
        if (!rattachement.ok) {
          await trx.rollback()
          return this.refusRattachement(ctx, rattachement)
        }
      }
      await trx.commit()
    } catch (error) {
      await trx.rollback()
      throw error
    }

    await offre.refresh()
    await this.tracer(ctx, offre, 'created', { after: this.resume(offre) })
    if (rattachement.ok) await this.tracerRattachements(ctx, offre, rattachement)
    return ctx.response.created({ data: await this.detailler(offre) })
  }

  /** PATCH /admin/offers/:id — tous les champs de l'offre sont modifiables. */
  async update(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { launchedOn, features, price, ...champs } =
      await ctx.request.validateUsing(updateOfferValidator)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)

    const statut = champs.status ?? offre.status
    const date = launchedOn !== undefined ? launchedOn : (offre.launchedOn?.toISODate() ?? null)
    const probleme = activationProblem({
      status: statut as 'active' | 'inactive',
      launchedOn: date,
    })
    if (probleme) return this.regleMetier(ctx, 'E_OFFER_LAUNCH_DATE_REQUIRED', probleme)

    if (champs.code && champs.code !== offre.code && (await this.codePris(champs.code, offre.id))) {
      return this.codeDejaPris(ctx, champs.code)
    }

    const avant = this.resume(offre)
    offre.merge(champs)
    if (price !== undefined) offre.price = String(price)
    if (launchedOn !== undefined) {
      offre.launchedOn = launchedOn ? DateTime.fromISO(launchedOn) : null
    }
    if (features !== undefined) offre.features = normalizeFeatures(features)
    await offre.save()
    await offre.refresh()

    await this.tracer(ctx, offre, 'updated', { before: avant, after: this.resume(offre) })
    return ctx.response.ok({ data: await this.detailler(offre) })
  }

  /** DELETE /admin/offers/:id — suppression LOGIQUE ; ses organisations n'ont plus d'offre. */
  async destroy(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)

    const avant = this.resume(offre)
    const liberees = await db.transaction(async (trx) => {
      const lignes: { organization_id: string }[] = await trx
        .from('offer_organizations')
        .where('offer_id', offre.id)
        .delete()
        .returning('organization_id')
      offre.useTransaction(trx)
      offre.deletedAt = DateTime.now()
      await offre.save()
      return lignes.map((l) => l.organization_id)
    })

    for (const organizationId of liberees) {
      await this.tracerSous(ctx, organizationId, offre, 'organization_removed', {
        before: { offerId: offre.id },
        after: { offerId: null },
      })
    }
    await this.tracer(ctx, offre, 'deleted', {
      before: avant,
      metadata: { organizationIds: liberees },
    })
    return ctx.response.noContent()
  }

  /**
   * POST /admin/offers/:id/organizations — body : { organizationIds, move? }
   *
   * Idempotent pour les organisations déjà détentrices de CETTE offre.
   * 404 si une organisation n'existe pas ; 409 `E_ORGANIZATION_HAS_OFFER` si
   * l'une détient une autre offre, sauf `move: true`.
   */
  async attachOrganizations(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationIds, move } = await ctx.request.validateUsing(
      attachOfferOrganizationsValidator
    )
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)

    const trx = await db.transaction()
    let rattachement: Attachment
    try {
      rattachement = await this.rattacher(trx, offre.id, organizationIds, move ?? false, ctx)
      if (!rattachement.ok) {
        await trx.rollback()
        return this.refusRattachement(ctx, rattachement)
      }
      await trx.commit()
    } catch (error) {
      await trx.rollback()
      throw error
    }

    await this.tracerRattachements(ctx, offre, rattachement)
    return ctx.response.ok({
      data: {
        ...(await this.detailler(offre)),
        attached: rattachement.attached,
        moved: rattachement.moved,
      },
    })
  }

  /** DELETE /admin/offers/:id/organizations/:organizationId — l'organisation n'a plus d'offre. */
  async detachOrganization(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)

    const organizationId: string = ctx.params.organizationId
    const supprimees = await db
      .from('offer_organizations')
      .where({ offer_id: offre.id, organization_id: organizationId })
      .delete()
    const retiree = Number(Array.isArray(supprimees) ? supprimees[0] : supprimees) > 0

    if (retiree) {
      await this.tracerSous(ctx, organizationId, offre, 'organization_removed', {
        before: { offerId: offre.id },
        after: { offerId: null },
      })
    }
    return ctx.response.ok({ data: { ...(await this.detailler(offre)), unchanged: !retiree } })
  }

  // -------------------------------------------------------------------------

  private trouver(id: string): Promise<OfferModel | null> {
    return OfferModel.query().where('id', id).whereNull('deleted_at').first()
  }

  /**
   * Rattache `ids` à l'offre, dans `trx`. Vérifie l'existence des
   * organisations et les offres qu'elles détiennent déjà ; l'unicité de
   * `organization_id` en base reste le rempart en cas de course.
   */
  private async rattacher(
    trx: TransactionClientContract,
    offerId: string,
    ids: string[],
    move: boolean,
    ctx: HttpContext
  ): Promise<Attachment> {
    const existantes: { id: string }[] = await trx
      .from('organizations')
      .whereIn('id', ids)
      .whereNull('deleted_at')
      .select('id')
    const connues = new Set(existantes.map((o) => o.id))
    const missing = ids.filter((id) => !connues.has(id))
    if (missing.length) return { ok: false, missing }

    const actuels: { organization_id: string; offer_id: string; code: string; name: string }[] =
      await trx
        .from('offer_organizations as l')
        .join('offers as o', 'o.id', 'l.offer_id')
        .whereIn('l.organization_id', ids)
        .select('l.organization_id', 'l.offer_id', 'o.code', 'o.name')
    const ailleurs = actuels.filter((l) => l.offer_id !== offerId)
    if (ailleurs.length && !move) {
      return {
        ok: false,
        conflicts: ailleurs.map((l) => ({
          organizationId: l.organization_id,
          offer: { id: l.offer_id, code: l.code, name: l.name },
        })),
      }
    }

    if (ailleurs.length) {
      await trx
        .from('offer_organizations')
        .whereIn(
          'organization_id',
          ailleurs.map((l) => l.organization_id)
        )
        .delete()
    }
    const deja = new Set(
      actuels.filter((l) => l.offer_id === offerId).map((l) => l.organization_id)
    )
    const nouvelles = ids.filter((id) => !deja.has(id))
    if (nouvelles.length) {
      const actorId = toExecutionContext(ctx).actorId
      await trx.table('offer_organizations').insert(
        nouvelles.map((organizationId) => ({
          offer_id: offerId,
          organization_id: organizationId,
          assigned_by: actorId,
        }))
      )
    }
    return {
      ok: true,
      attached: nouvelles,
      moved: ailleurs.map((l) => ({ organizationId: l.organization_id, fromOfferId: l.offer_id })),
    }
  }

  private refusRattachement(ctx: HttpContext, refus: Exclude<Attachment, { ok: true }>) {
    if ('missing' in refus) {
      return ctx.response.notFound({
        error: {
          code: 'E_NOT_FOUND',
          message:
            refus.missing.length > 1 ? 'Organisations introuvables' : 'Organisation introuvable',
          details: { organizationIds: refus.missing },
        },
      })
    }
    return ctx.response.conflict({
      error: {
        code: 'E_ORGANIZATION_HAS_OFFER',
        message:
          'Une organisation ne détient qu’une offre : déplacez-la (move: true) ou détachez-la de son offre actuelle',
        details: { conflicts: refus.conflicts },
      },
    })
  }

  /** Organisations détentrices de chaque offre — une seule requête pour toute la page. */
  private async detenteurs(offerIds: string[]): Promise<Map<string, Holder[]>> {
    const parOffre = new Map<string, Holder[]>()
    if (offerIds.length === 0) return parOffre
    const lignes: {
      offer_id: string
      id: string
      code: string
      name: string
      is_active: boolean
      assigned_at: Date
    }[] = await db
      .from('offer_organizations as l')
      .join('organizations as g', 'g.id', 'l.organization_id')
      .whereIn('l.offer_id', offerIds)
      .whereNull('g.deleted_at')
      .orderBy('g.name')
      .select('l.offer_id', 'g.id', 'g.code', 'g.name', 'g.is_active', 'l.assigned_at')
    for (const l of lignes) {
      const liste = parOffre.get(l.offer_id) ?? []
      liste.push({
        id: l.id,
        code: l.code,
        name: l.name,
        isActive: l.is_active,
        assignedAt: new Date(l.assigned_at).toISOString(),
      })
      parOffre.set(l.offer_id, liste)
    }
    return parOffre
  }

  /** Ligne de liste : offre + pages ouvertes + organisations détentrices. */
  private exposer(o: OfferModel, organisations: Holder[]) {
    return {
      ...o.serialize(),
      paths: pathsOf(o.features),
      organizations: organisations,
      organizationsCount: organisations.length,
    }
  }

  /** Détail : + véhicules de chaque organisation, pour lire le quota `maxVehicles`. */
  private async detailler(o: OfferModel) {
    const parOffre = await this.detenteurs([o.id])
    const organisations = parOffre.get(o.id) ?? []
    const vehicules = new Map<string, number>()
    if (organisations.length) {
      const lignes: { organization_id: string; total: string | number }[] = await db
        .from('vehicles')
        .whereIn(
          'organization_id',
          organisations.map((g) => g.id)
        )
        .whereNull('deleted_at')
        .groupBy('organization_id')
        .select('organization_id')
        .count('* as total')
      for (const l of lignes) vehicules.set(l.organization_id, Number(l.total))
    }
    return this.exposer(
      o,
      organisations.map((g) => ({ ...g, vehicles: vehicules.get(g.id) ?? 0 }))
    )
  }

  private async codePris(code: string, exceptId?: string): Promise<boolean> {
    const query = OfferModel.query().where('code', code).whereNull('deleted_at').select('id')
    if (exceptId) query.whereNot('id', exceptId)
    return (await query.first()) !== null
  }

  private codeDejaPris(ctx: HttpContext, code: string) {
    return ctx.response.conflict({
      error: {
        code: 'E_OFFER_CODE_TAKEN',
        message: 'Ce code est déjà utilisé par une autre offre',
        details: { code },
      },
    })
  }

  private regleMetier(ctx: HttpContext, code: string, message: string) {
    return ctx.response.unprocessableEntity({ error: { code, message, details: {} } })
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Offre introuvable', details: {} },
    })
  }

  private resume(o: OfferModel): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of AUDITED) {
      const v = o[k]
      out[k] = v instanceof DateTime ? v.toISODate() : (v ?? null)
    }
    return out
  }

  /** Une trace par organisation rattachée (ou déplacée depuis une autre offre). */
  private async tracerRattachements(
    ctx: HttpContext,
    offre: OfferModel,
    r: Extract<Attachment, { ok: true }>
  ) {
    const depuis = new Map(r.moved.map((m) => [m.organizationId, m.fromOfferId]))
    for (const organizationId of r.attached) {
      await this.tracerSous(ctx, organizationId, offre, 'organization_assigned', {
        before: { offerId: depuis.get(organizationId) ?? null },
        after: { offerId: offre.id },
      })
    }
  }

  /** Trace sous l'organisation de l'acteur (exploitant). */
  private tracer(
    ctx: HttpContext,
    offre: OfferModel,
    action: string,
    details: {
      before?: Record<string, unknown>
      after?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    return this.audit.record({
      context: toExecutionContext(ctx),
      action: `billing.offer.${action}`,
      resourceType: 'offer',
      resourceId: offre.id,
      ...details,
    })
  }

  /** Trace sous l'organisation CONCERNÉE : elle la retrouve dans son journal. */
  private tracerSous(
    ctx: HttpContext,
    organizationId: string,
    offre: OfferModel,
    action: string,
    details: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ) {
    return this.audit.record({
      context: { ...toExecutionContext(ctx), organizationId },
      action: `billing.offer.${action}`,
      resourceType: 'offer',
      resourceId: offre.id,
      metadata: { offerCode: offre.code },
      ...details,
    })
  }
}
