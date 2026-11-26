/**
 * ZONES GÉOGRAPHIQUES — types en dur.
 *
 * Type de zone : autorisée (les règles se déclenchent à la sortie) ou
 * interdite (à l'entrée) — `geofenceAlerts` dans rule_policy.
 */
/*
Interface definissant la latitude ou la longitude
*/
export interface LatLng {
  lat: number
  lng: number
}

/*
Type de zone pour le geofencing 
soit autorisé ou interdit
*/
export const GEOFENCE_KINDS = ['authorized', 'forbidden'] as const
export type GeofenceKind = (typeof GEOFENCE_KINDS)[number]

/*
Type de geofence soit cercle ou polygon
*/
export const GEOFENCE_SHAPES = ['circle', 'polygon'] as const
export type GeofenceShape = (typeof GEOFENCE_SHAPES)[number]

/** Rayon minimal d'une zone circulaire (mètres). */
//rayon minimal d'une zone circulaire soit 50m
export const MIN_CIRCLE_RADIUS_M = 50

/** Nombre minimal de sommets d'un polygone. */
/*
rayon minimal pour créer un polygon soit 3 points
*/
export const MIN_POLYGON_POINTS = 3

/** Géométrie à contrôler (`geofenceProblem`). */
/*
Interface pour créer un brouillon pour la géometrie
*/
export interface GeofenceDraft {
  name: string
  shape: GeofenceShape
  center: LatLng | null
  radiusM: number | null
  points: readonly LatLng[]
}
