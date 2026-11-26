/**
 * RÈGLES — opérateurs de comparaison d'une condition :
 *
 *   gt       >   supérieur (greater than)
 *   lt       <   inférieur (less than)
 *   eq       =   égal (equal)
 *   neq      ≠   différent (not equal)
 *   in           dans la plage horaire (inside)
 *   outside      hors de la plage horaire
 *
 * Opérateurs permis pour chaque champ : `RULE_OPERATORS_BY_FIELD` (rule_fields).
 */
/** Comparaisons qui ont un sens pour chaque champ. */
/*
opérateur de comparaison pour une règle
gt > great than
lt < less than
eq = egal 
neq != not equal 
in (inside)
outside (outside)
*/
export const RULE_OPERATORS = ['gt', 'lt', 'eq', 'neq', 'in', 'outside'] as const
export type RuleOperator = (typeof RULE_OPERATORS)[number]
