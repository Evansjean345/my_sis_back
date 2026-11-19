import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  SOUSCRIPTIONS — une organisation, une offre, un groupe de véhicules
 * =========================================================================
 *
 * La souscription remplace le rattachement direct offre ↔ organisation
 * (`offer_organizations`, migration 023) : une organisation souscrit à
 * PLUSIEURS offres, une par groupe de véhicules (une flotte en Gold, une
 * autre en Standard…), et une offre est souscrite par plusieurs organisations.
 *
 * ① Montant calculé, jamais stocké
 *   `unit_price` est le TARIF APPLIQUÉ par véhicule et par période (prix de
 *   l'offre par défaut, négociable). Le nombre de véhicules est celui du
 *   groupe à l'instant T, et le montant = tarif × véhicules : l'API les
 *   calcule à la lecture, ils ne peuvent pas diverger.
 *
 * ② Le groupe appartient au client
 *   Clé étrangère composite (vehicle_group_id, organization_id) → vehicle_groups :
 *   la base refuse une souscription sur la flotte d'un autre client.
 *
 * ③ Un contrat vivant par flotte
 *   Index unique partiel : un groupe n'a qu'une souscription non résiliée.
 *
 * ④ Statuts : draft → active ⇄ suspended → terminated (définitif).
 *   Seules les souscriptions ACTIVES ouvrent les pages du distributeur.
 *
 * ⑤ Référence : saisie libre, sinon `SUB-AAAA-00001` (séquence dédiée).
 *
 * Les rattachements de `offer_organizations` n'ont pas de groupe de véhicules :
 * ils ne peuvent pas devenir des souscriptions et sont supprimés avec la table
 * (leur nombre est signalé par un NOTICE). Le `down()` recrée la table à partir
 * des souscriptions actives.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      DO $$
      DECLARE n integer;
      BEGIN
        SELECT count(*) INTO n FROM offer_organizations;
        IF n > 0 THEN
          RAISE NOTICE 'offer_organizations : % rattachement(s) supprimé(s) — recréez-les en souscriptions', n;
        END IF;
      END $$;

      CREATE SEQUENCE subscription_reference_seq;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_groups_id_organization
        ON vehicle_groups (id, organization_id);

      CREATE TABLE subscriptions (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reference        text NOT NULL DEFAULT (
          'SUB-' || to_char(now(), 'YYYY') || '-' ||
          lpad(nextval('subscription_reference_seq')::text, 5, '0')
        ),
        organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        offer_id         uuid NOT NULL REFERENCES offers (id) ON DELETE RESTRICT,
        vehicle_group_id uuid NOT NULL,
        unit_price       numeric(14,2) NOT NULL,
        currency         char(3) NOT NULL DEFAULT 'XOF',
        status           text NOT NULL DEFAULT 'draft',
        start_date       date NOT NULL DEFAULT current_date,
        end_date         date,
        notes            text,
        created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        deleted_at       timestamptz,
        CONSTRAINT fk_subscriptions_vehicle_group
          FOREIGN KEY (vehicle_group_id, organization_id)
          REFERENCES vehicle_groups (id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT ck_subscriptions_reference CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/.-]{1,39}$'),
        CONSTRAINT ck_subscriptions_unit_price CHECK (unit_price >= 0),
        CONSTRAINT ck_subscriptions_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_subscriptions_status CHECK (status IN ('draft','active','suspended','terminated')),
        CONSTRAINT ck_subscriptions_dates CHECK (end_date IS NULL OR end_date >= start_date)
      );

      COMMENT ON TABLE subscriptions IS 'Souscriptions : organisation × offre × groupe de véhicules';
      COMMENT ON COLUMN subscriptions.unit_price IS 'Tarif appliqué, par véhicule et par période de l''offre';

      CREATE UNIQUE INDEX uq_subscriptions_reference ON subscriptions (lower(reference))
        WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_subscriptions_live_vehicle_group ON subscriptions (vehicle_group_id)
        WHERE deleted_at IS NULL AND status <> 'terminated';
      CREATE INDEX idx_subscriptions_organization ON subscriptions (organization_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_subscriptions_offer ON subscriptions (offer_id) WHERE deleted_at IS NULL;

      CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();

      DROP TABLE offer_organizations;
    `)
  }

  async down() {
    this.schema.raw(`
      CREATE TABLE offer_organizations (
        offer_id        uuid NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        assigned_at     timestamptz NOT NULL DEFAULT now(),
        assigned_by     uuid REFERENCES users (id) ON DELETE SET NULL,
        PRIMARY KEY (offer_id, organization_id),
        CONSTRAINT uq_offer_organizations_organization UNIQUE (organization_id)
      );

      INSERT INTO offer_organizations (offer_id, organization_id, assigned_at, assigned_by)
      SELECT DISTINCT ON (organization_id) offer_id, organization_id, created_at, created_by
      FROM subscriptions
      WHERE deleted_at IS NULL AND status = 'active'
      ORDER BY organization_id, created_at;

      DROP TABLE subscriptions;
      DROP SEQUENCE subscription_reference_seq;
      DROP INDEX IF EXISTS uq_vehicle_groups_id_organization;
    `)
  }
}
