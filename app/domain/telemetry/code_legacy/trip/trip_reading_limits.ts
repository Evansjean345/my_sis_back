/**
 * TRAJETS — limites de lecture.
 *
 * Elles protègent la base (`positions` est partitionnée par mois et peut
 * compter des millions de lignes) et la connexion du tableau de bord.
 */

/** Période maximale d'une liste de trajets : au-delà, la recherche se découpe. */
export const TRIP_LIST_MAX_RANGE_DAYS = 31

export const TRIP_LIST_DEFAULT_PER_PAGE = 25
export const TRIP_LIST_MAX_PER_PAGE = 100

/**
 * Points d'un trajet lus par page (curseur sur `recorded_at`). Un trajet
 * d'une journée à une trame toutes les 10 s fait ~8 600 points : 5 pages.
 */
export const TRIP_POINTS_DEFAULT_LIMIT = 500
export const TRIP_POINTS_MAX_LIMIT = 2000

/** Véhicules suivis en direct par une même connexion. */
export const LIVE_MAX_FOLLOWED_VEHICLES = 200
