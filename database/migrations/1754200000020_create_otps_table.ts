import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  OTP — codes à usage unique envoyés par SMS (Twilio)
 * =========================================================================
 *
 * Premier usage : la réinitialisation du mot de passe (`password_reset`).
 * La colonne `purpose` permet d'en ajouter d'autres (vérification du numéro,
 * confirmation d'une action sensible) sans nouvelle table.
 *
 * ① Le code n'est JAMAIS stocké en clair : `code_hash` = HMAC-SHA256(code,
 *   APP_KEY). Un code à 6 chiffres n'a que 10⁶ valeurs : un simple SHA-256 se
 *   retrouverait en une fraction de seconde à partir d'une fuite de la base.
 *   La clé HMAC reste hors de la base.
 *
 * ② UN SEUL code actif par compte et par usage : index unique partiel
 *   `uq_otps_active`. Demander un nouveau code invalide le précédent
 *   (`invalidated_at`) dans la même transaction ; deux demandes simultanées
 *   ne peuvent pas laisser deux codes valides.
 *
 * ③ Tentatives bornées (`attempts <= max_attempts`) : au-delà, le code est
 *   invalidé. Le compteur est incrémenté sous verrou de ligne (FOR UPDATE)
 *   pour qu'une rafale parallèle ne dépasse pas le plafond.
 *
 * ④ `consumed_at` : un code accepté par la réinitialisation ne sert qu'une
 *   fois. La vérification préalable (`/auth/password/verify`) ne le consomme
 *   pas, mais ses échecs comptent.
 *
 * ⑤ Index `idx_notifications_provider_message` : le webhook d'accusés de
 *   remise Twilio retrouve le SMS par son identifiant `SM…`.
 *
 * Rétention : les codes expirés n'ont aucune valeur probante au-delà de
 * quelques jours ; `sisbm_purge_otps()` les efface (à planifier, cf. docs/09).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE otps (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        purpose         text NOT NULL,
        channel         text NOT NULL DEFAULT 'sms',
        recipient       text NOT NULL,
        code_hash       text NOT NULL,
        attempts        smallint NOT NULL DEFAULT 0,
        max_attempts    smallint NOT NULL DEFAULT 5,
        expires_at      timestamptz NOT NULL,
        consumed_at     timestamptz,
        invalidated_at  timestamptz,
        notification_id uuid REFERENCES notifications (id) ON DELETE SET NULL,
        requested_ip    inet,
        user_agent      text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_otps_purpose   CHECK (purpose IN ('password_reset')),
        CONSTRAINT ck_otps_channel   CHECK (channel IN ('sms','whatsapp')),
        CONSTRAINT ck_otps_recipient CHECK (recipient ~ '^\\+[1-9][0-9]{7,14}$'),
        CONSTRAINT ck_otps_attempts  CHECK (attempts >= 0 AND attempts <= max_attempts),
        CONSTRAINT ck_otps_max       CHECK (max_attempts BETWEEN 1 AND 10),
        CONSTRAINT ck_otps_expiry    CHECK (expires_at > created_at)
      );

      -- ② un seul code actif par compte et par usage
      CREATE UNIQUE INDEX uq_otps_active ON otps (user_id, purpose)
        WHERE consumed_at IS NULL AND invalidated_at IS NULL;

      -- quota d'émission (« 5 codes par heure ») et purge
      CREATE INDEX idx_otps_user_purpose_created ON otps (user_id, purpose, created_at DESC);
      CREATE INDEX idx_otps_expires ON otps (expires_at);
    `)

    // Accusés de remise Twilio (webhook) : retrouver le SMS par son SID `SM…`.
    this.schema.raw(`
      CREATE INDEX idx_notifications_provider_message ON notifications (provider_message_id)
        WHERE provider_message_id IS NOT NULL;
    `)

    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_purge_otps(p_keep interval DEFAULT interval '7 days')
      RETURNS integer
      LANGUAGE plpgsql AS $$
      DECLARE
        v_count integer;
      BEGIN
        DELETE FROM otps WHERE expires_at < now() - p_keep;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END $$;
    `)
  }

  async down() {
    this.schema.raw(`DROP FUNCTION IF EXISTS sisbm_purge_otps(interval)`)
    this.schema.raw(`DROP INDEX IF EXISTS idx_notifications_provider_message`)
    this.schema.raw(`DROP TABLE IF EXISTS otps`)
  }
}
