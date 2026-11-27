import { DomainError } from '#domain/kernel'

/** Changement de statut interdit par la machine à états (ex. rouvrir un dossier clos). */
export class InvalidIncidentTransitionError extends DomainError {
  readonly code = 'E_INVALID_INCIDENT_TRANSITION'
  readonly httpStatus = 409

  constructor(from: string, to: string, allowed: readonly string[]) {
    super(
      allowed.length === 0
        ? `Un incident « ${from} » ne change plus de statut.`
        : `Passage de « ${from} » à « ${to} » impossible (possible : ${allowed.join(', ')}).`,
      { from, to, allowed }
    )
  }
}

/** Résolution absente ou trop courte pour résoudre ou classer un dossier. */
export class IncidentResolutionRequiredError extends DomainError {
  readonly code = 'E_INCIDENT_RESOLUTION_REQUIRED'
  readonly httpStatus = 422

  constructor(status: string, minLength: number) {
    super(
      `Décrivez la résolution (${minLength} caractères au moins) pour passer à « ${status} ».`,
      {
        status,
        minLength,
      }
    )
  }
}

/** Véhicule inconnu, supprimé ou d'une autre organisation que le dossier. */
export class IncidentVehicleOutOfScopeError extends DomainError {
  readonly code = 'E_INCIDENT_VEHICLE_OUT_OF_SCOPE'
  readonly httpStatus = 422

  constructor(vehicleId: string) {
    super("Ce véhicule n'appartient pas à l'organisation de l'incident.", { vehicleId })
  }
}
