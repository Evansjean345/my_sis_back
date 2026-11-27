import vine from '@vinejs/vine'

/**
 * Rapport de trajets — dates civiles incluses (AAAA-MM-JJ, UTC = heure
 * d'Abidjan). La longueur de la période est une règle du domaine (93 jours).
 */
const jour = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

export const tripReportValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid(),
    from: jour(),
    to: jour(),
  })
)
