import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  Simplification du socle d'identité
 * =========================================================================
 *
 * ① `organizations.currency` est supprimée : le solde SMS n'est plus porté
 *   par une organisation (cf. migration 015), une organisation n'a donc plus
 *   de devise propre.
 *
 * ② Trois rôles système seulement : `super_admin`, `admin`, `operator`.
 *   `supervisor` (Superviseur) et `viewer` (Consultation) disparaissent.
 *   Leurs utilisateurs sont retirés AVANT les rôles (`users.role_id` est en
 *   ON DELETE RESTRICT) :
 *     - sans historique  → supprimés définitivement ;
 *     - avec historique (a demandé ou validé une commande, figure dans le
 *       journal des commandes, a installé ou retiré un boîtier) → suppression
 *       LOGIQUE : `deleted_at`, statut `suspended`, sessions révoquées, rôle
 *       reporté sur `operator` pour libérer le rôle supprimé.
 *       Une suppression physique mettrait `validated_by` / `actor_id` à NULL
 *       et effacerait QUI a validé une immobilisation : la piste d'audit
 *       exigée par le TDR (§II.5) serait cassée. Le compte, lui, disparaît
 *       de l'application comme un compte supprimé : toutes les lectures
 *       filtrent `deleted_at IS NULL`, et son e-mail / téléphone redeviennent
 *       libres.
 *
 * ③ Un e-mail et un numéro de téléphone identifient UN SEUL compte actif —
 *   prérequis du « mot de passe oublié » par e-mail ou par SMS.
 *   L'e-mail était déjà unique (`uq_users_email`, citext : insensible à la
 *   casse) ; le téléphone le devient (`uq_users_phone`). Le format E.164 déjà
 *   imposé par `ck_users_phone` garantit qu'un même numéro s'écrit d'une
 *   seule façon. Les deux index ignorent les comptes supprimés logiquement.
 */
export default class extends BaseSchema {
  async up() {
    // ------------------------------------------------------------- ① devise
    this.schema.raw(`ALTER TABLE organizations DROP COLUMN IF EXISTS currency`)

    // ------------------------------------------------------------- ② rôles
    this.schema.raw(`
      DO $$
      DECLARE
        v_operator uuid;
        v_conserves int;
        v_supprimes int;
      BEGIN
        SELECT id INTO v_operator FROM roles WHERE organization_id IS NULL AND code = 'operator';
        IF v_operator IS NULL THEN
          RAISE EXCEPTION 'Rôle système operator introuvable : migration impossible';
        END IF;

        CREATE TEMP TABLE _comptes_retires ON COMMIT DROP AS
          SELECT u.id,
                 (   EXISTS (SELECT 1 FROM device_commands d
                             WHERE d.requested_by = u.id OR d.validated_by = u.id)
                  OR EXISTS (SELECT 1 FROM device_command_logs l WHERE l.actor_id = u.id)
                  OR EXISTS (SELECT 1 FROM device_assignments a
                             WHERE a.installed_by = u.id OR a.removed_by = u.id)
                 ) AS a_historique
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE r.organization_id IS NULL AND r.code IN ('supervisor', 'viewer');

        -- avec historique : suppression logique, la trace d'audit reste intacte
        UPDATE users u
           SET role_id    = v_operator,
               status     = 'suspended',
               deleted_at = coalesce(u.deleted_at, now())
          FROM _comptes_retires c
         WHERE c.id = u.id AND c.a_historique;
        GET DIAGNOSTICS v_conserves = ROW_COUNT;

        DELETE FROM auth_access_tokens t
         USING _comptes_retires c
         WHERE t.tokenable_id = c.id;

        -- sans historique : suppression définitive
        DELETE FROM users u
         USING _comptes_retires c
         WHERE c.id = u.id AND NOT c.a_historique;
        GET DIAGNOSTICS v_supprimes = ROW_COUNT;

        DELETE FROM roles WHERE organization_id IS NULL AND code IN ('supervisor', 'viewer');

        RAISE NOTICE 'Rôles supervisor/viewer supprimés : % compte(s) supprimé(s), % compte(s) avec historique supprimé(s) logiquement',
          v_supprimes, v_conserves;
      END
      $$;
    `)

    // ------------------------------------------------------------- ③ unicité
    // Un doublon existant ferait échouer la création de l'index avec un
    // message obscur : on le signale d'abord, comptes concernés à l'appui.
    this.schema.raw(`
      DO $$
      DECLARE
        v_doublons text;
      BEGIN
        SELECT string_agg(phone || ' (' || n || ' comptes)', ', ') INTO v_doublons
          FROM (SELECT phone, count(*) AS n FROM users
                 WHERE deleted_at IS NULL AND phone IS NOT NULL
                 GROUP BY phone HAVING count(*) > 1) d;
        IF v_doublons IS NOT NULL THEN
          RAISE EXCEPTION 'Numéros de téléphone partagés par plusieurs comptes actifs : %. '
            'Corriger ces comptes avant de relancer la migration.', v_doublons;
        END IF;
      END
      $$;

      CREATE UNIQUE INDEX uq_users_phone ON users (phone)
        WHERE deleted_at IS NULL AND phone IS NOT NULL;
    `)
  }

  /**
   * Restaure la STRUCTURE (colonne, rôles, index). Les comptes supprimés
   * définitivement ne peuvent pas être recréés.
   */
  async down() {
    this.schema.raw(`DROP INDEX IF EXISTS uq_users_phone`)

    this.schema.raw(`
      INSERT INTO roles (code, name, description, permissions, is_system) VALUES
        ('supervisor', 'Superviseur', 'Supervision, traitement des alertes et incidents',
          ARRAY['vehicle:read','device:read','geofence:read','policy:read','alert:*','incident:*','report:read','command:request'], true),
        ('viewer', 'Consultation', 'Lecture seule',
          ARRAY['vehicle:read','alert:read','incident:read','report:read'], true)
      ON CONFLICT (code) WHERE organization_id IS NULL DO NOTHING
    `)

    this.schema.raw(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'XOF'`
    )
  }
}
