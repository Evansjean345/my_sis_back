/**
 * =========================================================================
 *  MESSAGE E-MAIL — règles pures, sans I/O
 * =========================================================================
 */

/** Même motif que `ck_users_email` et `ck_otps_recipient` (migration 021). */
export const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value)
}

/** `evans.katchi@sisbm.ci` → `ev*********@sisbm.ci` (journaux, audit). */
export function maskEmail(email: string): string {
  const [local, domaine] = email.split('@')
  if (!domaine) return '***'
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 1))}@${domaine}`
}

/**
 * Échappement HTML de toute donnée insérée dans un corps HTML (nom complet,
 * e-mail…). Un nom saisi par un administrateur ne doit jamais pouvoir
 * injecter de balise dans un e-mail envoyé au nom de la plateforme.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
