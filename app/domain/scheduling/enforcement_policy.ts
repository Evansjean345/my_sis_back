import type { DesiredUsage } from '#domain/scheduling/usage_policy'

/**
 * =========================================================================
 *  DÉCISION DU MOTEUR D'APPLICATION — que faire, à ce passage, pour ce véhicule ?
 * =========================================================================
 *
 * Le verdict d'usage dit ce que le véhicule DEVRAIT être. Cette fonction
 * décide s'il faut agir, en tenant compte de ce qui s'est réellement passé.
 * Pure, déterministe, testable sans base ni horloge.
 *
 * Quatre principes, tous issus du terrain :
 *
 *  ① AGIR SUR LES TRANSITIONS, PAS SUR L'ÉTAT
 *    Le moteur n'arme une action qu'au changement de verdict (entrée ou
 *    sortie de plage). Sans cela, il renverrait une coupure à chaque minute.
 *
 *  ② INSISTER JUSQU'À L'OBJECTIF
 *    Une coupure armée reste en attente tant qu'elle n'est pas CONFIRMÉE par
 *    le boîtier (`acknowledged`). Le cas nominal est un véhicule qui roule
 *    encore à l'heure de fermeture : le garde-fou CM-07 refuse, le moteur
 *    retente au passage suivant, et coupe dès que le véhicule s'arrête.
 *
 *  ③ NE JAMAIS LIBÉRER CE QU'ON N'A PAS COUPÉ
 *    Le rétablissement automatique n'a lieu que si la dernière coupure
 *    confirmée vient d'un calendrier. Une immobilisation manuelle (vol,
 *    impayé) n'est jamais levée par l'ouverture d'une plage horaire.
 *
 *  ④ L'OPÉRATEUR A LE DERNIER MOT
 *    Toute commande moteur manuelle passée après l'armement annule l'action
 *    en attente (dérogation). Le moteur ne revient à la charge qu'à la
 *    transition suivante.
 */
export type EnforcementAction = 'cut' | 'restore'

/* Mémoire du moteur entre deux passages (`vehicle_schedule_states`) */
export interface EnforcementMemory {
  readonly desired: DesiredUsage
  readonly pendingAction: EnforcementAction | null
  readonly pendingSince: Date | null
  /** Pas de nouvelle tentative avant cette date (null = immédiatement). */
  readonly nextAttemptAt: Date | null
}

/** Dernière commande moteur CONFIRMÉE par le boîtier, quelle qu'en soit l'origine. */
export interface ConfirmedEngineCommand {
  readonly commandType: 'engine_cut' | 'engine_restore'
  readonly origin: string
  readonly at: Date
}

export interface EnforcementInput {
  readonly desired: DesiredUsage
  readonly previous: EnforcementMemory | null
  readonly lastConfirmed: ConfirmedEngineCommand | null
  /** Une commande occupe le boîtier (approved / queued / sent) : CM-09. */
  readonly commandInFlight: boolean
  /** Dernière commande moteur demandée par un humain ou une intégration (origine ≠ schedule). */
  readonly lastOperatorCommandAt: Date | null
  readonly now: Date
}

export type EnforcementOutcome =
  /** Rien à faire. */
  | 'idle'
  /** Une action est armée et part maintenant. */
  | 'dispatch'
  /** Action armée, une commande est déjà en vol : on attend son issue. */
  | 'waiting_in_flight'
  /** Action armée, délai entre deux tentatives non écoulé. */
  | 'waiting_retry'
  /** L'objectif est atteint (coupure ou rétablissement confirmé). */
  | 'completed'
  /** Un opérateur a repris la main après l'armement. */
  | 'overridden'
  /** Fin de plage, mais le moteur a été coupé à la main : on ne libère pas. */
  | 'manual_cut_kept'
  /** Début de plage, moteur déjà coupé : rien à émettre. */
  | 'already_immobilized'

export interface EnforcementDecision {
  readonly memory: EnforcementMemory
  readonly action: EnforcementAction | null
  readonly outcome: EnforcementOutcome
  /** Vrai si le verdict vient de changer (entrée / sortie de plage). */
  readonly transition: boolean
}

export function decideEnforcement(input: EnforcementInput): EnforcementDecision {
  const { desired, previous, lastConfirmed, now } = input
  const transition = !previous || previous.desired !== desired
  const moteurCoupe = lastConfirmed?.commandType === 'engine_cut'
  const coupeParCalendrier = moteurCoupe && lastConfirmed?.origin === 'schedule'

  let pending: EnforcementAction | null = previous?.pendingAction ?? null
  let since: Date | null = previous?.pendingSince ?? null
  let nextAttemptAt: Date | null = previous?.nextAttemptAt ?? null
  let outcome: EnforcementOutcome = 'idle'

  if (transition) {
    // ① armement sur transition — l'action précédente, quelle qu'elle soit, est abandonnée
    nextAttemptAt = null
    if (desired === 'immobilized') {
      pending = moteurCoupe ? null : 'cut'
      if (moteurCoupe) outcome = 'already_immobilized'
    } else {
      // ③ on ne libère que ce qu'un calendrier a coupé
      pending = coupeParCalendrier ? 'restore' : null
      if (moteurCoupe && !coupeParCalendrier) outcome = 'manual_cut_kept'
    }
    since = pending ? now : null
  } else if (pending) {
    if (
      input.lastOperatorCommandAt &&
      since &&
      input.lastOperatorCommandAt.getTime() > since.getTime()
    ) {
      // ④ dérogation opérateur
      pending = null
      outcome = 'overridden'
    } else if (
      (pending === 'cut' && moteurCoupe) ||
      (pending === 'restore' && lastConfirmed?.commandType === 'engine_restore')
    ) {
      // ② objectif atteint
      pending = null
      outcome = 'completed'
    }
    if (!pending) {
      since = null
      nextAttemptAt = null
    }
  }

  const memory: EnforcementMemory = {
    desired,
    pendingAction: pending,
    pendingSince: since,
    nextAttemptAt,
  }

  if (!pending) return { memory, action: null, outcome, transition }

  if (input.commandInFlight) {
    return { memory, action: null, outcome: 'waiting_in_flight', transition }
  }
  if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) {
    return { memory, action: null, outcome: 'waiting_retry', transition }
  }
  return { memory, action: pending, outcome: 'dispatch', transition }
}
