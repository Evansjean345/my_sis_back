import type {
  EnforcementAction,
  EnforcementOutcome,
} from '#domain/scheduling/code_legacy/schedule/schedule_enforcement'
import type { DesiredUsage } from '#domain/scheduling/code_legacy/schedule/schedule_usage'
import type {
  ConfirmedEngineCommand,
  EnforcementDecision,
  EnforcementInput,
  EnforcementMemory,
} from '#domain/scheduling/code_legacy/schedule/schedule_types'

/**
 * =========================================================================
 *  DÉCISION DU MOTEUR D'APPLICATION — que faire, à ce passage, pour ce véhicule ?
 * =========================================================================
 *
 * Le verdict d'usage dit ce que le véhicule DEVRAIT être. Cette fonction
 * compare avec ce que le boîtier a réellement confirmé et décide de l'action.
 * Pure, déterministe, testable sans base ni horloge. Types : `code_legacy/schedule`.
 *
 * Le système est AUTOMATIQUE : aucune décision d'opérateur n'est prise en
 * compte. Trois principes :
 *
 *  ① L'ÉTAT, PAS LA TRANSITION
 *    Tant qu'un véhicule est hors de ses plages et que son moteur n'est pas
 *    coupé, le moteur coupe. Un rétablissement manuel pendant les heures
 *    interdites est donc recoupé au passage suivant.
 *
 *  ② INSISTER JUSQU'À L'OBJECTIF
 *    Une coupure reste en attente tant qu'elle n'est pas CONFIRMÉE par le
 *    boîtier (`acknowledged`). Cas nominal : le véhicule roule encore à
 *    l'heure de fermeture, le garde-fou CM-07 refuse, le moteur retente au
 *    passage suivant et coupe dès que le véhicule s'arrête.
 *
 *  ③ NE JAMAIS LIBÉRER CE QU'ON N'A PAS COUPÉ
 *    Le rétablissement n'a lieu que si la dernière coupure confirmée vient
 *    d'un calendrier. Une immobilisation manuelle (vol, impayé) n'est jamais
 *    levée par l'ouverture d'une plage horaire.
 */

/** Action nécessaire pour atteindre l'état voulu, compte tenu du moteur réel. */
/*
DesireUsage = "free" / "immobilized"
*/
export function requiredAction(
  desired: DesiredUsage,
  lastConfirmed: ConfirmedEngineCommand | null
): EnforcementAction | null {
  const moteurCoupe = lastConfirmed?.commandType === 'engine_cut'
  if (desired === 'immobilized') return moteurCoupe ? null : 'cut'
  // ③ on ne libère que ce qu'un calendrier a coupé
  return moteurCoupe && lastConfirmed?.origin === 'schedule' ? 'restore' : null
}

/** Moteur coupé par quelqu'un d'autre qu'un calendrier (opérateur, politique, intégration). */
/*
Fonction de coupure moteur manuel
*/
export function isManualCut(lastConfirmed: ConfirmedEngineCommand | null): boolean {
  return lastConfirmed?.commandType === 'engine_cut' && lastConfirmed.origin !== 'schedule'
}

/*
Fonction pour décider de l'application pour une coupure moteur
*/
export function decideEnforcement(input: EnforcementInput): EnforcementDecision {
  const { desired, previous, lastConfirmed, now } = input
  const transition = !previous || previous.desired !== desired
  const enAttente = previous?.pendingAction ?? null
  //constante pour decider de l'action requise
  const action = requiredAction(desired, lastConfirmed)

  if (!action) {
    const memory: EnforcementMemory = {
      desired,
      pendingAction: null,
      pendingSince: null,
      nextAttemptAt: null,
    }
    return {
      memory,
      action: null,
      outcome: idleOutcome(input, enAttente, transition),
      transition,
      resumed: false,
    }
  }

  // ② même action qu'au passage précédent : on garde son début et son délai de relance
  const resumed = enAttente === action
  const memory: EnforcementMemory = {
    desired,
    pendingAction: action,
    pendingSince: resumed ? (previous?.pendingSince ?? now) : now,
    nextAttemptAt: resumed ? (previous?.nextAttemptAt ?? null) : null,
  }

  if (input.commandInFlight) {
    return { memory, action: null, outcome: 'waiting_in_flight', transition, resumed }
  }
  if (memory.nextAttemptAt && memory.nextAttemptAt.getTime() > now.getTime()) {
    return { memory, action: null, outcome: 'waiting_retry', transition, resumed }
  }
  return { memory, action, outcome: 'dispatch', transition, resumed }
}

/**
 * Rien à émettre : pourquoi ? Les issues ponctuelles ne sont rendues qu'au
 * moment où elles se produisent (transition, ou fin d'une action en attente),
 * jamais à chaque passage.
 */
/*
Fonction de traitement d'une sortie s'il n'y a rien a faire
*/
function idleOutcome(
  input: EnforcementInput,
  enAttente: EnforcementAction | null,
  transition: boolean
): EnforcementOutcome {
  const { desired, lastConfirmed } = input
  if (desired === 'free' && isManualCut(lastConfirmed)) {
    return transition || enAttente ? 'manual_cut_kept' : 'idle'
  }
  if (enAttente && !transition) return 'completed'
  if (transition && desired === 'immobilized') return 'already_immobilized'
  return 'idle'
}
