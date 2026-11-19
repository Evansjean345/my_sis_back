import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  OFFRES ↔ ORGANISATIONS — une offre, plusieurs organisations
 * =========================================================================
 *
 * La migration 022 rattachait une offre à UNE organisation
 * (`offers.organization_id`). Une offre du catalogue (Standard, Gold…) est
 * désormais partagée par autant d'organisations que nécessaire : le lien
 * passe dans une table dédiée.
 *
 * ① Une organisation n'a qu'UNE offre à la fois : clé unique sur
 *   `organization_id`. Changer d'offre = déplacer le lien.
 * ② `ON DELETE CASCADE` des deux côtés : une organisation ou une offre
 *   supprimée physiquement emporte ses liens. La suppression LOGIQUE d'une
 *   offre retire ses liens côté API.
 * ③ Reprise : chaque `offers.organization_id` existant devient un lien, puis
 *   la colonne disparaît.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE offer_organizations (
        offer_id        uuid NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        assigned_at     timestamptz NOT NULL DEFAULT now(),
        assigned_by     uuid REFERENCES users (id) ON DELETE SET NULL,
        PRIMARY KEY (offer_id, organization_id),
        CONSTRAINT uq_offer_organizations_organization UNIQUE (organization_id)
      );

      COMMENT ON TABLE offer_organizations IS 'Organisations détentrices d''une offre — une offre par organisation';

      INSERT INTO offer_organizations (offer_id, organization_id)
      SELECT id, organization_id FROM offers
      WHERE organization_id IS NOT NULL AND deleted_at IS NULL;

      DROP INDEX IF EXISTS uq_offers_organization;
      ALTER TABLE offers DROP COLUMN organization_id;
    `)
  }

  async down() {
    // Retour au modèle 022 : une organisation par offre (la plus ancienne conservée).
    this.schema.raw(`
      ALTER TABLE offers ADD COLUMN organization_id uuid REFERENCES organizations (id) ON DELETE SET NULL;

      UPDATE offers o SET organization_id = l.organization_id
      FROM (
        SELECT DISTINCT ON (offer_id) offer_id, organization_id
        FROM offer_organizations ORDER BY offer_id, assigned_at
      ) l
      WHERE l.offer_id = o.id;

      CREATE UNIQUE INDEX uq_offers_organization ON offers (organization_id)
        WHERE organization_id IS NOT NULL AND deleted_at IS NULL;

      DROP TABLE offer_organizations;
    `)
  }
}
