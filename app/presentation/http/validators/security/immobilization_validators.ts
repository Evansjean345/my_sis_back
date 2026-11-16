import vine from '@vinejs/vine'

/**
 * Validation d'entrée HTTP (VineJS).
 *
 * Elle porte sur la FORME : type, présence, longueur. Les règles MÉTIER
 * (vitesse, machine à états) restent dans le domaine.
 * Confondre les deux revient à disperser la sécurité dans les contrôleurs.
 */
export const requestImmobilizationValidator = vine.compile(
  vine.object({
    vehicleId: vine.string().uuid(),
    reason: vine.string().trim().minLength(5).maxLength(500),
    alertId: vine.string().uuid().optional(),
  })
)

/**
 * Rétablissement du moteur : pas de contrôle de vitesse, mais un motif
 * obligatoire — c'est la pièce d'audit qui explique pourquoi on a rendu
 * l'alimentation à un véhicule immobilisé.
 */
export const restoreEngineValidator = vine.compile(
  vine.object({
    vehicleId: vine.string().uuid(),
    reason: vine.string().trim().minLength(5).maxLength(500),
  })
)
