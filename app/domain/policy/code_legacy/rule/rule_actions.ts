/**
 * RÈGLES — actions déclenchées quand une règle est vérifiée :
 *   alert     créer une alerte (valeur = gravité)
 *   notify    notifier (canaux : push + SMS / e-mail)
 *   incident  ouvrir un incident (valeur = file de traitement)
 *   command   commande boîtier, ex. coupure moteur (valeur = commande)
 */
/*
moteur de règles pour définir ce qu'une règle doit faire
alert - notify - incident - command
le système doit alerter ?
notifier ? 
définir comme une incident !
ou lancer une commande .
*/
export const RULE_ACTION_TYPES = ['alert', 'notify', 'incident', 'command'] as const
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number]

/** Actions dont le paramètre (`value`) est facultatif. */
export const ACTIONS_WITHOUT_VALUE: readonly RuleActionType[] = ['alert', 'notify']
