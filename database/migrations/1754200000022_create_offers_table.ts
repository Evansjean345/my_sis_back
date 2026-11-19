import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  OFFRES COMMERCIALES
 * =========================================================================
 *
 * Une offre décrit ce qu'un client paie et ce qu'il obtient : prix,
 * périodicité, nombre de véhicules suivis, profondeur de l'historique GPS
 * et fonctionnalités du tableau de bord Admin.
 *
 * ① Catalogue d'abord
 *   L'offre se crée et se modifie SANS organisation (`organization_id`
 *   facultatif), puis se rattache à un client. `ON DELETE SET NULL` : une
 *   organisation supprimée libère son offre au lieu de la détruire.
 *
 * ② Une offre par organisation
 *   Index unique partiel sur `organization_id` (offres vivantes) : à tout
 *   moment, il n'y a qu'UNE offre applicable à un client. Changer d'offre =
 *   détacher l'ancienne, rattacher la nouvelle.
 *
 * ③ Règles portées par la base
 *   - code unique (offres vivantes), stocké en MAJUSCULES ;
 *   - prix ≥ 0 ; limite de véhicules NULL (illimité) ou > 0 ;
 *   - historique GPS entre 1 et 3 650 jours ;
 *   - périodicité et statut dans leurs listes ; une offre naît `inactive` ;
 *   - une offre `active` a une date de commercialisation ;
 *   - fonctionnalités : clés du catalogue uniquement
 *     (`app/domain/billing/offer_policy.ts`, `OFFER_FEATURES`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE offers (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid REFERENCES organizations (id) ON DELETE SET NULL,
        code             text NOT NULL,
        name             text NOT NULL,
        description      text,
        price            numeric(14,2) NOT NULL DEFAULT 0,
        currency         char(3) NOT NULL DEFAULT 'XOF',
        periodicity      text NOT NULL DEFAULT 'monthly',
        status           text NOT NULL DEFAULT 'inactive',
        launched_on      date,
        max_vehicles     integer,
        gps_history_days integer NOT NULL DEFAULT 30,
        features         text[] NOT NULL DEFAULT '{}',
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        deleted_at       timestamptz,
        CONSTRAINT ck_offers_code         CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
        CONSTRAINT ck_offers_name         CHECK (length(btrim(name)) > 0),
        CONSTRAINT ck_offers_price        CHECK (price >= 0),
        CONSTRAINT ck_offers_currency     CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_offers_periodicity  CHECK (periodicity IN ('monthly','quarterly','semiannual','annual')),
        CONSTRAINT ck_offers_status       CHECK (status IN ('active','inactive')),
        CONSTRAINT ck_offers_active_launched CHECK (status <> 'active' OR launched_on IS NOT NULL),
        CONSTRAINT ck_offers_max_vehicles CHECK (max_vehicles IS NULL OR max_vehicles > 0),
        CONSTRAINT ck_offers_gps_history  CHECK (gps_history_days BETWEEN 1 AND 3650),
        CONSTRAINT ck_offers_features     CHECK (
          features <@ ARRAY['fleet','zones','drivers','incidents','support','speed','alerts']::text[]
        )
      );

      COMMENT ON TABLE  offers IS 'Offres commerciales : catalogue, rattachables à une organisation (une offre vivante par organisation)';
      COMMENT ON COLUMN offers.max_vehicles IS 'Nombre maximal de véhicules suivis ; NULL = illimité';
      COMMENT ON COLUMN offers.gps_history_days IS 'Profondeur de l''historique de trajets consultable, en jours';
      COMMENT ON COLUMN offers.features IS 'Clés des fonctionnalités du tableau de bord Admin incluses';

      CREATE UNIQUE INDEX uq_offers_code ON offers (code) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_offers_organization ON offers (organization_id)
        WHERE organization_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX idx_offers_status ON offers (status) WHERE deleted_at IS NULL;
      CREATE INDEX idx_offers_name_trgm ON offers USING gin (name gin_trgm_ops);

      CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON offers
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)
  }

  async down() {
    this.schema.raw(`DROP TABLE IF EXISTS offers`)
  }
}
