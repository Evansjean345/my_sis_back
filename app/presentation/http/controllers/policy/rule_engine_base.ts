import type { HttpContext } from '@adonisjs/core/http'
import type { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  organizationExists,
  ownerOf,
  type RuleEngineKind,
  setActive,
} from '#infrastructure/persistence/repositories/rule_engine_repository'
import { authorize, type Permission } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import {
  ruleEngineListValidator,
  toggleValidator,
} from '#presentation/http/validators/policy/rule_engine_validators'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * =========================================================================
 *  MOTEUR DE RÈGLES — socle des contrôleurs (zones, vitesse, règles)
 * =========================================================================
 *
 * Chaque ressource est servie deux fois, avec les mêmes règles :
 *   - `/api/v1/admin/*` (Super Admin, joker `*`) : toutes les organisations,
 *     `organizationId` obligatoire à la création, filtre facultatif en liste ;
 *   - `/api/v1/*` (organisation) : celle du compte connecté uniquement.
 *
 * Aucune suppression : on active / désactive (`POST /:id/toggle`).
 * Les méthodes `…Refuse` envoient la réponse d'erreur et renvoient `true`.
 */
export abstract class RuleEngineBase {
  constructor(protected readonly audit: LucidAuditLogger) {}

  /** Ressource servie (activation, audit, messages). */
  protected abstract readonly kind: RuleEngineKind
  protected abstract readonly label: string
  protected abstract readonly view: Permission
  protected abstract readonly manage: Permission

  // ---------------------------------------------------------------- périmètre

  /**
   * Organisation visée par une LECTURE : `null` = toutes (plateforme sans
   * filtre). Contrôle les habilitations.
   */
  protected async listScope(ctx: HttpContext, platform: boolean): Promise<string | null> {
    if (!platform) {
      await authorize(ctx, this.view)
      return toExecutionContext(ctx).organizationId
    }
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(ruleEngineListValidator)
    return organizationId ?? null
  }

  /**
   * Organisation visée par une CRÉATION ; `null` si la réponse d'erreur a été
   * envoyée (organisation manquante ou inconnue).
   */
  protected async createScope(
    ctx: HttpContext,
    platform: boolean,
    requested: unknown
  ): Promise<string | null> {
    if (!platform) {
      await authorize(ctx, this.manage)
      return toExecutionContext(ctx).organizationId
    }
    await authorizePlatform(ctx)
    if (
      typeof requested !== 'string' ||
      !UUID.test(requested) ||
      !(await organizationExists(requested))
    ) {
      this.regle(ctx, 'E_VALIDATION', 'Client inconnu.')
      return null
    }
    return requested
  }

  /**
   * Organisation propriétaire de la ressource `:id`, si l'appelant y a accès ;
   * sinon 404 envoyé et `null`.
   */
  protected async ownedScope(ctx: HttpContext, platform: boolean): Promise<string | null> {
    if (platform) await authorizePlatform(ctx)
    else await authorize(ctx, this.manage)
    const owner = await ownerOf(this.kind, ctx.params.id)
    if (!owner || (!platform && owner !== toExecutionContext(ctx).organizationId)) {
      this.introuvable(ctx)
      return null
    }
    return owner
  }

  // ----------------------------------------------------------------- activation

  protected async basculer(ctx: HttpContext, platform: boolean) {
    const { active } = await ctx.request.validateUsing(toggleValidator)
    const owner = await this.ownedScope(ctx, platform)
    if (!owner) return
    await setActive(this.kind, ctx.params.id, active)
    await this.tracer(ctx, owner, ctx.params.id, active ? 'activated' : 'deactivated', {
      after: { active },
    })
    return ctx.response.noContent()
  }

  // ------------------------------------------------------------------- erreurs

  /**
   * Erreurs de la base traduites : unicité du nom (409), contrainte de
   * forme — polygone qui se recoupe, bornes — (422).
   */
  protected async enregistrer<T>(ctx: HttpContext, save: () => Promise<T>): Promise<T | null> {
    try {
      return await save()
    } catch (error: any) {
      if (error?.code === '23505') {
        ctx.response.conflict({
          error: { code: 'E_NAME_TAKEN', message: 'Ce nom est déjà utilisé.', details: {} },
        })
        return null
      }
      if (error?.code === '23514' || error?.code === 'XX000' || error?.code === '22023') {
        const message = String(error?.constraint ?? error?.message ?? '').includes('valid')
          ? 'Polygone invalide : ses côtés ne doivent pas se croiser.'
          : 'Valeur hors des limites autorisées.'
        this.regle(ctx, 'E_VALIDATION', message)
        return null
      }
      throw error
    }
  }

  protected nomPris(ctx: HttpContext) {
    return ctx.response.conflict({
      error: {
        code: 'E_NAME_TAKEN',
        message: `Ce nom de ${this.label} est déjà utilisé.`,
        details: {},
      },
    })
  }

  protected regle(ctx: HttpContext, code: string, message: string) {
    return ctx.response.unprocessableEntity({ error: { code, message, details: {} } })
  }

  protected introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Élément introuvable.', details: {} },
    })
  }

  // --------------------------------------------------------------------- audit

  /** Trace sous l'organisation cliente : elle la retrouve dans son journal. */
  protected tracer(
    ctx: HttpContext,
    organizationId: string,
    id: string,
    action: string,
    details: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ) {
    return this.audit.record({
      context: { ...toExecutionContext(ctx), organizationId },
      action: `rules.${this.kind}.${action}`,
      resourceType:
        this.kind === 'rule' ? 'policy' : this.kind === 'speed' ? 'speed_policy' : 'geofence',
      resourceId: id,
      ...details,
    })
  }
}
