import type { TelemetryFrame } from '#application/telemetry/dto/telemetry_frame'
import type {
  TripListPage,
  TripListQuery,
  TripLiveUpdate,
  TripPoint,
  TripReadScope,
  TripSummary,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import type {
  TripReportQuery,
  VehicleTripStats,
} from '#domain/telemetry/code_legacy/trip/trip_report_types'

/**
 * Ports applicatifs du contexte Télémétrie.
 */

/** Contexte d'un boîtier résolu depuis son identifiant. */

export interface ResolvedDevice {
  deviceId: string
  organizationId: string
  vehicleId: string | null
  hasRelay: boolean
  flespiDeviceId: number | null
}

export interface DeviceResolver {
  /** `null` si le boîtier est inconnu. Résultat mis en cache par l'adaptateur. */
  resolve(ident: string): Promise<ResolvedDevice | null>
  invalidate(ident: string): Promise<void>
}

/**
 * Abstraction du transport temps réel.
 *
 * C'est ce port qui rend toute la chaîne testable SANS broker : en test, on
 * injecte une implémentation en mémoire qui pousse des trames à la demande.
 */

export interface TelemetryTransport {
  /**
   * `handler` doit résoudre APRÈS persistance : l'acquittement au broker n'est
   * émis qu'ensuite. Une base indisponible provoque un rejeu, pas une perte.
   */
  subscribe(handler: (raw: string, topic: string) => Promise<void>): Promise<void>
  disconnect(): Promise<void>
  readonly isConnected: boolean
}

/** Diffusion vers les tableaux de bord (SSE et Socket.IO). */
export interface RealtimeBroadcaster {
  publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void>
  /**
   * État de connexion d'un boîtier (en ligne, fix GPS, contact…), diffusé
   * pour TOUTE trame reçue — y compris sans position exploitable. C'est ce
   * qui rend visible un tracker garé sous un toit. Optionnel : un diffuseur
   * qui ne l'implémente pas ne casse rien.
   */
  publishDeviceStatus?(organizationId: string, payload: DeviceStatusPayload): Promise<void>
  /**
   * Trajet en cours : ouverture, nouveaux points, clôture. Publié APRÈS le
   * COMMIT de l'ingestion (Socket.IO). Optionnel, comme l'état du boîtier.
   */
  publishTrip?(organizationId: string, update: TripLiveUpdate): Promise<void>
}

export interface DeviceStatusPayload {
  deviceId: string
  vehicleId: string | null
  ident: string
  /** ISO 8601 — réception serveur de la dernière trame. */
  lastSeenAt: string
  /** ISO 8601 — horodatage GPS de la dernière trame. */
  lastRecordedAt: string
  /** La dernière trame portait-elle un fix GPS valide ? */
  hasFix: boolean
  /** Trame en différé (Store & Forward) plutôt qu'en direct. */
  delayed: boolean
  ignition: boolean | null
  gsmSignal: number | null
  batteryPct: number | null
}

// ---------------------------------------------------------------------------
// Lecture des trajets (connexion persistante Socket.IO)
// ---------------------------------------------------------------------------

/** Fenêtre de points d'un trajet, lue par page (curseur exclusif sur `recorded_at`). */
export interface TripPointsQuery {
  readonly vehicleId: string
  /** Boîtier du trajet : un véhicule à deux trackers ne mélange pas leurs points. */
  readonly deviceId: string | null
  readonly from: Date
  /** `null` : trajet encore ouvert, pas de borne haute. */
  readonly to: Date | null
  readonly after: Date | null
  readonly limit: number
}

export interface TripReader {
  list(query: TripListQuery): Promise<TripListPage>
  find(tripId: string): Promise<TripSummary | null>
  points(query: TripPointsQuery): Promise<TripPoint[]>
  /** Véhicules vivants de ce périmètre, parmi `vehicleIds`. */
  vehiclesInScope(scope: TripReadScope, vehicleIds: readonly string[]): Promise<string[]>
  organizationExists(organizationId: string): Promise<boolean>
  /** Trajets par véhicule sur la période (tous les véhicules de l'organisation, même sans trajet). */
  vehicleStats(query: TripReportQuery): Promise<VehicleTripStats[]>
}

export type { TelemetryFrame }
