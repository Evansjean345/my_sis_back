/**
 * PLAGES HORAIRES — valeurs par défaut et limites.
 */

/*
Fusiau horaire pour abidjan
*/
/** Fuseau d'un calendrier quand il n'est pas précisé (IANA). */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Africa/Abidjan'

/** Une semaine complète tient largement en 100 plages. */
/*
Une semaine sur 100 plages horaires
*/
export const MAX_SCHEDULE_WINDOWS = 100

/** Longueur du nom d'un calendrier. */
/*
longueur du nom d'un calendrier 2 - 80 - 300
*/
export const SCHEDULE_NAME_MIN_LENGTH = 2
export const SCHEDULE_NAME_MAX_LENGTH = 80
export const SCHEDULE_DESCRIPTION_MAX_LENGTH = 300

/** Au-delà, une analyse se découpe (et l'agrégation reste rapide). */
/*
analyses des jours
*/
export const ANALYTICS_MAX_DAYS = 93
