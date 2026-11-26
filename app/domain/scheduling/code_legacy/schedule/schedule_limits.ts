/**
 * PLAGES HORAIRES — valeurs par défaut et limites.
 */

/** Fuseau d'un calendrier quand il n'est pas précisé (IANA). */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Africa/Abidjan'

/** Une semaine complète tient largement en 100 plages. */
export const MAX_SCHEDULE_WINDOWS = 100

/** Longueur du nom d'un calendrier. */
export const SCHEDULE_NAME_MIN_LENGTH = 2
export const SCHEDULE_NAME_MAX_LENGTH = 80
export const SCHEDULE_DESCRIPTION_MAX_LENGTH = 300

/** Au-delà, une analyse se découpe (et l'agrégation reste rapide). */
export const ANALYTICS_MAX_DAYS = 93
