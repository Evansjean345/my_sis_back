/**
 * PLAGES HORAIRES — application automatique au moteur du véhicule.
 *
 * Le moteur `node ace sisbm:schedules:enforce` agit seul : aucune décision
 * d'un opérateur n'interrompt une coupure planifiée.
 */

/** Ce que le moteur demande au boîtier. Aligné sur `ck_vehicle_schedule_states_pending`. */
/*
application des actions pour 
couper ou restaurer le moteur d'un véhicule
*/
export const ENFORCEMENT_ACTIONS = ['cut', 'restore'] as const
export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number]

/**
 * Issue d'un passage pour un véhicule :
 *
 *  idle                 rien à faire
 *  dispatch             une commande part maintenant
 *  waiting_in_flight    une commande occupe déjà le boîtier (CM-09) : on attend son issue
 *  waiting_retry        refus précédent, délai avant la prochaine tentative non écoulé
 *  completed            objectif atteint (coupure ou rétablissement confirmé par le boîtier)
 *  manual_cut_kept      dans la plage, mais le moteur a été coupé à la main : on ne libère pas
 *  already_immobilized  sortie de plage, moteur déjà coupé : rien à émettre
 */
/*
application des sorties d'une commande sur véhicule
rien à faire 
dispatcher une commande 
une commande est déjà en attente
refus d'une commande 
completed (objectif atteint pour immobilisation dans une plage)
coupure à la main etant dans la plage horaire
déjà immobilisé
*/
export const ENFORCEMENT_OUTCOMES = [
  'idle',
  'dispatch',
  'waiting_in_flight',
  'waiting_retry',
  'completed',
  'manual_cut_kept',
  'already_immobilized',
] as const
export type EnforcementOutcome = (typeof ENFORCEMENT_OUTCOMES)[number]

/**
 * Événements du journal `schedule_enforcement_events` (CHECK `ck_schedule_events_kind`) :
 *
 *  transition           entrée / sortie de plage
 *  dispatched           commande émise (échec passerelle compris : son statut le dira)
 *  refused              tentative refusée avant l'envoi, une ligne par tentative
 *  completed …          issues ponctuelles, une seule fois par action
 */
/*
application des types dévènements sur une plage horaire
*/
export const ENFORCEMENT_EVENT_KINDS = [
  'transition',
  'dispatched',
  'refused',
  'completed',
  'manual_cut_kept',
  'already_immobilized',
] as const
export type EnforcementEventKind = (typeof ENFORCEMENT_EVENT_KINDS)[number]

/** Issues journalisées une seule fois, au moment où elles se produisent. */
export const ONE_TIME_OUTCOMES = [
  'completed',
  'manual_cut_kept',
  'already_immobilized',
] as const satisfies readonly (EnforcementOutcome & EnforcementEventKind)[]

/**
 * Refus PASSAGERS : la situation se règle d'elle-même (véhicule qui roule
 * encore à l'heure de fermeture, position pas encore reçue…), on retente
 * vite. Tout autre refus (immobilisation désactivée sur le véhicule, pas de
 * relais, interrupteur général coupé) attend le délai long.
 */
/*
refus d'immobilization pour une plage horaire sur un véhicule
vehicule en mouvement
vitesse dangereuse
pas de position
commande en cours 
modification simultané
*/
export const TRANSIENT_REFUSAL_CODES = [
  'E_VEHICLE_IN_MOTION',
  'E_UNSAFE_SPEED',
  'E_NO_POSITION',
  'E_STALE_POSITION',
  'E_COMMAND_IN_FLIGHT',
  'E_CONCURRENT_MODIFICATION',
] as const

/** Échec de la passerelle après création de la commande (le statut de la commande le précise). */
/*
echec après creation de la commande sur une passerelle
*/
export const DISPATCH_FAILED_CODE = 'E_DISPATCH_FAILED'
