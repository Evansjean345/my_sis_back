import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  SOUSCRIPTIONS — retour à la seule cible « flotte »
 * =========================================================================
 *
 * Annule le rattachement à un opérateur (migration 030). L'administrateur
 * d'une organisation est désormais le client final : il souscrit pour SES
 * flottes, l'opérateur reste en retrait et n'a plus de souscription propre.
 *
 *   - les souscriptions d'opérateur (sans flotte) sont supprimées — elles ne
 *     peuvent pas exister sans `vehicle_group_id` ;
 *   - `vehicle_group_id` redevient obligatoire ;
 *   - le rôle système `admin` GARDE `subscription:*` : il gère les
 *     souscriptions de ses flottes.
 *
 * Écrite pour passer que la 030 ait été jouée ou non (IF EXISTS partout).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'subscriptions' AND column_name = 'operator_id'
        ) THEN
          DELETE FROM subscriptions WHERE operator_id IS NOT NULL;
        END IF;
      END $$;

      DROP INDEX IF EXISTS idx_subscriptions_operator;
      DROP INDEX IF EXISTS uq_subscriptions_live_operator;
      ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS ck_subscriptions_target;
      ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS fk_subscriptions_operator;
      ALTER TABLE subscriptions DROP COLUMN IF EXISTS operator_id;
      ALTER TABLE subscriptions ALTER COLUMN vehicle_group_id SET NOT NULL;
      DROP INDEX IF EXISTS uq_users_id_organization;

      UPDATE roles SET permissions = array_append(permissions, 'subscription:*')
      WHERE is_system AND code = 'admin' AND NOT ('subscription:*' = ANY (permissions));
    `)
  }

  /** Rétablit le schéma de la 030 (sans données d'opérateur à restaurer). */
  async down() {
    this.schema.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_organization ON users (id, organization_id);
      ALTER TABLE subscriptions ALTER COLUMN vehicle_group_id DROP NOT NULL;
      ALTER TABLE subscriptions ADD COLUMN operator_id uuid;
      ALTER TABLE subscriptions ADD CONSTRAINT fk_subscriptions_operator
        FOREIGN KEY (operator_id, organization_id)
        REFERENCES users (id, organization_id) ON DELETE RESTRICT;
      ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_target
        CHECK (num_nonnulls(vehicle_group_id, operator_id) = 1);
      CREATE UNIQUE INDEX uq_subscriptions_live_operator ON subscriptions (operator_id)
        WHERE operator_id IS NOT NULL AND deleted_at IS NULL AND status <> 'terminated';
      CREATE INDEX idx_subscriptions_operator ON subscriptions (operator_id)
        WHERE operator_id IS NOT NULL AND deleted_at IS NULL;
    `)
  }
}
