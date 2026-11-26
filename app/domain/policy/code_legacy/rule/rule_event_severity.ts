/**
 * RÈGLES — gravité d'une règle ou d'une alerte : critique / haute / moyenne / faible.
 * Même liste que la contrainte `ck_policies_severity` (migration 032).
 */
/*
Moteur de règle pour définir la sévérité d'une règle 
soit critique - haute - moyenne ou faible
*/
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]
