import type { UserContact, UserContactReader } from '#application/identity/ports'
import type { AccountIdentifier, OtpChannel } from '#domain/identity/otp_policy'

/** Compte ACTIF correspondant à l'identifiant saisi (e-mail ou téléphone). */
export function findActiveAccount(
  users: UserContactReader,
  identifier: AccountIdentifier
): Promise<UserContact | null> {
  return identifier.kind === 'email'
    ? users.findActiveByEmail(identifier.value)
    : users.findActiveByPhone(identifier.value)
}

/** Adresse de remise du compte pour ce canal ; `null` si le compte n'en a pas. */
export function addressFor(user: UserContact, channel: OtpChannel): string | null {
  return channel === 'email' ? user.email : user.phone
}
