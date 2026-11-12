import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  OTP PAR E-MAIL (Brevo)
 * =========================================================================
 *
 * La réinitialisation du mot de passe propose désormais deux canaux : SMS
 * (Twilio) ou e-mail (Brevo). Un code reste UNIQUE par compte et par usage
 * (`uq_otps_active`, inchangé) : demander un code par e-mail invalide le code
 * SMS en cours, et inversement.
 *
 * ① `ck_otps_channel` accepte `email`.
 * ② `ck_otps_recipient` dépend du canal : E.164 pour sms/whatsapp, adresse
 *   e-mail pour email (même motif que `ck_users_email`).
 * ③ `notifications` : contrôle symétrique de `ck_notifications_sms_addr`
 *   pour les e-mails. NOT VALID : les lignes existantes ne sont pas
 *   relues (il n'y en a pas — le canal e-mail n'était pas utilisé).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE otps DROP CONSTRAINT ck_otps_channel;
      ALTER TABLE otps DROP CONSTRAINT ck_otps_recipient;

      ALTER TABLE otps ADD CONSTRAINT ck_otps_channel
        CHECK (channel IN ('sms','whatsapp','email'));
      ALTER TABLE otps ADD CONSTRAINT ck_otps_recipient CHECK (
        (channel = 'email' AND recipient ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$')
        OR (channel <> 'email' AND recipient ~ '^\\+[1-9][0-9]{7,14}$')
      );

      ALTER TABLE notifications ADD CONSTRAINT ck_notifications_email_addr CHECK (
        channel <> 'email' OR recipient_address ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$'
      ) NOT VALID;
    `)
  }

  async down() {
    this.schema.raw(`
      ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notifications_email_addr;

      -- Les codes e-mail ne respectent pas l'ancienne contrainte : ils sont supprimés.
      DELETE FROM otps WHERE channel = 'email';

      ALTER TABLE otps DROP CONSTRAINT ck_otps_channel;
      ALTER TABLE otps DROP CONSTRAINT ck_otps_recipient;
      ALTER TABLE otps ADD CONSTRAINT ck_otps_channel CHECK (channel IN ('sms','whatsapp'));
      ALTER TABLE otps ADD CONSTRAINT ck_otps_recipient CHECK (recipient ~ '^\\+[1-9][0-9]{7,14}$');
    `)
  }
}
