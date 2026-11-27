import { Err, Ok, type Result } from '#domain/kernel'
import {
  INCIDENT_REFERENCE_DIGITS,
  INCIDENT_REFERENCE_PREFIX,
  INCIDENT_RESOLUTION_MIN_LENGTH,
} from '#domain/incident/code_legacy/incident/incident_limits'
import {
  INCIDENT_STATUSES_REQUIRING_RESOLUTION,
  INCIDENT_TRANSITIONS,
  type IncidentStatus,
} from '#domain/incident/code_legacy/incident/incident_statuses'
import {
  IncidentResolutionRequiredError,
  InvalidIncidentTransitionError,
} from '#domain/incident/errors'

/**
 * =========================================================================
 *  INCIDENTS — règles pures
 * =========================================================================
 *
 * Fonctions seulement : statuts, catégories, gravités et limites vivent dans
 * `code_legacy/incident`.
 */

/** Référence lisible d'un dossier : `INC-2026-000123`. */
export function incidentReference(year: number, sequence: number): string {
  return `${INCIDENT_REFERENCE_PREFIX}-${year}-${String(sequence).padStart(INCIDENT_REFERENCE_DIGITS, '0')}`
}

export function allowedTransitions(from: IncidentStatus): readonly IncidentStatus[] {
  return INCIDENT_TRANSITIONS[from]
}

/**
 * Vérifie un changement de statut et rend la résolution à enregistrer.
 *
 *   - la transition doit figurer dans `INCIDENT_TRANSITIONS` ;
 *   - résoudre ou classer exige une résolution, sauf si le dossier en a déjà une
 *     (clôture d'un dossier résolu) ;
 *   - rouvrir (`resolved → in_progress`) efface la résolution précédente.
 */
export function checkTransition(input: {
  from: IncidentStatus
  to: IncidentStatus
  resolution: string | null
  currentResolution: string | null
}): Result<{ resolution: string | null }> {
  const permis = INCIDENT_TRANSITIONS[input.from]
  if (!permis.includes(input.to)) {
    return Err(new InvalidIncidentTransitionError(input.from, input.to, permis))
  }

  const saisie = input.resolution?.trim() || null
  const exige = (INCIDENT_STATUSES_REQUIRING_RESOLUTION as readonly IncidentStatus[]).includes(
    input.to
  )
  if (!exige) return Ok({ resolution: null })

  const resolution = saisie ?? input.currentResolution
  if (!resolution || resolution.length < INCIDENT_RESOLUTION_MIN_LENGTH) {
    return Err(new IncidentResolutionRequiredError(input.to, INCIDENT_RESOLUTION_MIN_LENGTH))
  }
  return Ok({ resolution })
}
