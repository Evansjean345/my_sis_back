import transmit from '@adonisjs/transmit/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import { isPlatformOperator } from '#domain/identity/role_policy'
import { permissionsOf } from '#presentation/http/support/authorize'

/**
 * =========================================================================
 *  TEMPS RÉEL (SSE) — enregistrement ET cloisonnement des canaux
 * =========================================================================
 *
 * `transmit.registerRoutes()` expose trois routes HORS `/api/v1` :
 *
 *     GET  /__transmit/events        ouverture du flux
 *     POST /__transmit/subscribe     abonnement à un canal
 *     POST /__transmit/unsubscribe
 *
 * Elles ne traversent AUCUN middleware de route : `auth()` ne peut pas y être
 * posé, car `EventSource` (navigateur) n'envoie pas d'en-tête `Authorization`
 * sur l'ouverture du flux. Sans contrôle au niveau du CANAL, n'importe qui
 * pouvait donc s'abonner à `org/<uuid>/positions` et suivre en direct les
 * positions GPS d'une flotte — sans compte.
 *
 * Le contrôle est donc fait là où la donnée est réellement demandée :
 * à l'abonnement. Le flux `/__transmit/events` reste ouvert, mais il ne
 * transporte que les canaux dont l'abonnement a été accordé.
 *
 * Deux règles :
 *   ① `org/:organizationId/positions` — l'acteur doit être authentifié ET
 *     appartenir à cette organisation (le joker `*` voit tout).
 *   ② tout autre canal est REFUSÉ par défaut. Un canal ajouté demain sans
 *     règle explicite est fermé, pas ouvert.
 */

/**
 * Identifie l'appelant à partir du jeton porté par la requête d'abonnement.
 * `initialize_auth_middleware` est un middleware de ROUTER (cf. start/kernel) :
 * `ctx.auth` est donc disponible ici, même sans `auth()` sur la route.
 */
async function acteur(ctx: HttpContext) {
  await ctx.auth.authenticate() // lève si aucun jeton valide → abonnement refusé
  const user = ctx.auth.getUserOrFail() as { organizationId: string }
  return { organizationId: user.organizationId, permissions: await permissionsOf(ctx) }
}

transmit.authorize<{ organizationId: string }>(
  'org/:organizationId/positions',
  async (ctx: HttpContext, { organizationId }) => {
    const { organizationId: sienne, permissions } = await acteur(ctx)
    return isPlatformOperator(permissions) || sienne === organizationId
  }
)

/**
 * Refus par défaut. `matchit` classe les motifs du plus précis au moins
 * précis : la règle ci-dessus gagne sur ce joker, qui ne reçoit donc que les
 * canaux non déclarés.
 */
transmit.authorize('*', async () => false)

transmit.registerRoutes()
