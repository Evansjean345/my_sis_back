/**
 * TRAJETS — mises à jour diffusées en direct pendant l'ingestion.
 *
 *  started   un trajet vient de s'ouvrir (contact ON)
 *  progress  de nouveaux points ont été ajoutés au trajet ouvert
 *  closed    le trajet est clôturé (contact OFF ou expiration)
 */
export const TRIP_LIVE_UPDATE_TYPES = ['started', 'progress', 'closed'] as const
export type TripLiveUpdateType = (typeof TRIP_LIVE_UPDATE_TYPES)[number]
