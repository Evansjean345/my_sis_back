import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  SOUSCRIPTIONS — rattachement à un client final (opérateur)
 * =========================================================================
 *
 * Une souscription vise désormais UNE cible, au choix :
 *
 *   vehicle_group_id  une flotte de l'organisation (souscription du
 *                     distributeur, comme jusqu'ici) ;
 *   operator_id       un client final (opérateur) de l'organisation, qui ne
 *                     gère pas de groupes de véhicules.
 *
 * ① Exactement une cible : `ck_subscriptions_target`.
 * ② L'opérateur appartient à l'organisation de la souscription : clé
 *   étrangère composite (operator_id, organization_id) → users.
 * ③ Un contrat vivant par opérateur, comme par flotte (index unique partiel).
 * ④ Le rôle système `admin` (distributeur) reçoit `subscription:*` : il crée
 *   et gère les souscriptions de SES opérateurs, avec les offres qu'il a
 *   lui-même souscrites (règle appliquée par l'API).
 *
 * Accès (API) : un opérateur qui a sa propre souscription ne voit que son
 * offre ; les autres gardent l'offre de l'organisation (souscriptions de flotte).
 */
export default class extends BaseSchema {
  async up() {
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

      COMMENT ON COLUMN subscriptions.operator_id IS 'Client final (opérateur) visé — exclusif de vehicle_group_id';

      UPDATE roles SET permissions = array_append(permissions, 'subscription:*')
      WHERE is_system AND code = 'admin' AND NOT ('subscription:*' = ANY (permissions));
    `)
  }

  async down() {
    // Les souscriptions d'opérateur n'ont pas de flotte : elles ne survivent pas au retour arrière.
    this.schema.raw(`
      UPDATE roles SET permissions = array_remove(permissions, 'subscription:*')
      WHERE is_system AND code = 'admin';

      DELETE FROM subscriptions WHERE operator_id IS NOT NULL;
      DROP INDEX IF EXISTS idx_subscriptions_operator;
      DROP INDEX IF EXISTS uq_subscriptions_live_operator;
      ALTER TABLE subscriptions DROP CONSTRAINT ck_subscriptions_target;
      ALTER TABLE subscriptions DROP CONSTRAINT fk_subscriptions_operator;
      ALTER TABLE subscriptions DROP COLUMN operator_id;
      ALTER TABLE subscriptions ALTER COLUMN vehicle_group_id SET NOT NULL;
      DROP INDEX IF EXISTS uq_users_id_organization;
    `)
  }
}
