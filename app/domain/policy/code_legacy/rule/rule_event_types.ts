/**
 * =========================================================================
 *  RÈGLES — événements déclencheurs (référentiel en dur)
 * =========================================================================
 *
 * Événements GPS normalisés qui déclenchent une règle. Même liste que la
 * contrainte `ck_policies_trigger` (migration 034) et le tableau de bord.
 *
 * Retirés (migration 034) : `towing` (remorquage), `tamper` (sabotage du
 * boîtier), `harsh_driving` (conduite brutale).
 */
/*
Types d'évènements pour définir dans système de SISBM
*/
export const EVENT_TYPES = [
  'overspeed', // excès de vitesse
  'geofence_exit', // sortie de zone
  'geofence_entry', // entrée en zone
  'schedule_violation', // circulation hors horaires
  'power_cut', // coupure d'alimentation
  'disconnection', // perte de connexion
  'sos', // bouton SOS
  'jamming', // brouillage GPS / GSM
  'engine_start', // démarrage moteur
  'engine_stop', // arrêt moteur
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/**
 * Événements toujours notifiés par push seul (masqués des formulaires de
 * règle) : pas de SMS ni d'e-mail pour eux.
 */
/*
évènements notifier pour une push notification
*/
export const PUSH_ONLY_EVENT_TYPES: readonly EventType[] = [
  'sos',
  'jamming',
  'engine_stop',
  'disconnection',
]
