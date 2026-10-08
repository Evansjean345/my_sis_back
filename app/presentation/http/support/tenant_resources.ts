import type { HttpContext } from '@adonisjs/core/http'
import VehicleModel from '#infrastructure/persistence/models/vehicle_model'
import DeviceCommandModel from '#infrastructure/persistence/models/device_command_model'
import { organizationScope } from '#presentation/http/support/organization_scope'

/**
 * =========================================================================
 *  CLOISONNEMENT DES RESSOURCES DÉSIGNÉES PAR IDENTIFIANT DANS LE CORPS
 * =========================================================================
 *
 * Les routes `/security/*` reçoivent un `vehicleId` dans le corps ou un
 * `commandId` dans l'URL, puis délèguent au cas d'usage — qui lit l'état du
 * véhicule SANS filtre d'organisation. Sans contrôle en amont, un
 * administrateur client connaissant l'identifiant d'un véhicule d'un autre
 * client pouvait en demander l'immobilisation.
 *
 * Règle, identique au reste de l'API : une ressource hors du périmètre est
 * INTROUVABLE (404), jamais « interdite » — on ne confirme pas son existence.
 * Le détenteur du joker `*` voit toutes les organisations.
 */

export interface ScopedResource {
  id: string
  /** Organisation PROPRIÉTAIRE de la ressource (pas celle de l'acteur). */
  organizationId: string
}

/** Véhicule non archivé, dans le périmètre de l'acteur. */
/* Fonction retournant les véhicules dans périmètre d'une organisation */
export async function vehicleInScope(
  ctx: HttpContext,
  vehicleId: string
): Promise<ScopedResource | null> {
  const scope = await organizationScope(ctx)
  const query = VehicleModel.query()
    .where('id', vehicleId)
    .whereNull('deleted_at')
    .select('id', 'organization_id')
  if (!scope.isPlatform) query.where('organization_id', scope.organizationId)

  const vehicule = await query.first()
  return vehicule ? { id: vehicule.id, organizationId: vehicule.organizationId } : null
}

/** Commande boîtier, dans le périmètre de l'acteur. */
/*Fonction retournant les commandes dans le périmètre d'une organisation */
export async function commandInScope(
  ctx: HttpContext,
  commandId: string
): Promise<ScopedResource | null> {
  const scope = await organizationScope(ctx)
  const query = DeviceCommandModel.query().where('id', commandId).select('id', 'organization_id')
  if (!scope.isPlatform) query.where('organization_id', scope.organizationId)

  const commande = await query.first()
  return commande ? { id: commande.id, organizationId: commande.organizationId } : null
}

/** Réponse 404 au format d'erreur unique de l'API. */
/* Fonction retournant un resource non trouvé dans le périmètre d'une organisation */
export function notFoundInScope(ctx: HttpContext, ressource: string) {
  return ctx.response.notFound({
    error: { code: 'E_NOT_FOUND', message: `${ressource} introuvable`, details: {} },
  })
}

/**
 * 403 explicite pour une route réservée à l'exploitant.
 *
 * Plutôt qu'un 404 qui laisserait croire à une faute de chemin : le client
 * sait que l'opération existe, qu'elle ne lui est pas ouverte, et où elle vit.
 */
/*
Fonction utilisé pour gestions des resources uniqument reservé au super admin (exploitant SISBM)
*/
export function reservedToPlatform(ctx: HttpContext, operation: string) {
  return ctx.response.forbidden({
    error: {
      code: 'E_PLATFORM_ONLY',
      message: `${operation} : opération réservée à l'administration de la plateforme SISBM`,
      details: { adminEndpoint: `/api/v1/admin${ctx.request.url().replace(/^\/api\/v1/, '')}` },
    },
  })
}
