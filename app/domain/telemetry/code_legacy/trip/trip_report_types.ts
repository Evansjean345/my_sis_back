/**
 * =========================================================================
 *  TRAJETS — rapport d'activité par véhicule (référentiel en dur)
 * =========================================================================
 *
 * Les trajets `orphan` (démarrage sans déplacement) ne comptent pas : ils
 * fausseraient kilométrage et temps de conduite.
 */

export interface VehicleTripStats {
  readonly vehicleId: string
  readonly registration: string
  readonly trips: number
  readonly distanceKm: number
  /** Temps de conduite (contact mis), en secondes. */
  readonly drivingSeconds: number
  /** Dont véhicule à l'arrêt moteur tournant. */
  readonly idleSeconds: number
  readonly maxSpeedKph: number | null
  /** Moyenne sur la durée de conduite (km/h). */
  readonly avgSpeedKph: number | null
  readonly lastTripAt: string | null
}

export interface TripReportTotals {
  readonly trips: number
  readonly distanceKm: number
  readonly drivingSeconds: number
  readonly idleSeconds: number
  readonly maxSpeedKph: number | null
  /** Véhicules ayant roulé sur la période / véhicules de l'organisation. */
  readonly activeVehicles: number
  readonly vehicles: number
}

export interface TripReport {
  readonly organizationId: string
  readonly from: string
  readonly to: string
  readonly totals: TripReportTotals
  /** Tous les véhicules de l'organisation, du plus au moins roulant. */
  readonly vehicles: VehicleTripStats[]
}

export interface TripReportQuery {
  readonly organizationId: string
  readonly from: Date
  readonly to: Date
}
