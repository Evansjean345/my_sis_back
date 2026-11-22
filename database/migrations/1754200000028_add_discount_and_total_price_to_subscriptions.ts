import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  SOUSCRIPTIONS — remise et prix total
 * =========================================================================
 *
 * Le tarif appliqué ne dépend plus des véhicules ni du groupe : c'est un prix
 * FORFAITAIRE par période de l'offre.
 *
 *   offer_price  prix de l'offre, FIGÉ à la souscription (ex-`unit_price`,
 *                modifiable) : changer le prix d'une offre ne touche pas
 *                les contrats en cours ;
 *   discount     remise en montant (devise de la souscription), 0 par défaut,
 *                jamais supérieure au prix ;
 *   total_price  tarif appliqué = offer_price − discount, colonne GÉNÉRÉE par
 *                PostgreSQL : toujours juste, jamais saisie.
 *
 * Reprise : les souscriptions existantes gardent leur prix (`unit_price` →
 * `offer_price`) avec une remise nulle. Leur tarif appliqué devient ce prix
 * seul, et non plus prix × véhicules.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE subscriptions RENAME COLUMN unit_price TO offer_price;
      ALTER TABLE subscriptions RENAME CONSTRAINT ck_subscriptions_unit_price TO ck_subscriptions_offer_price;

      ALTER TABLE subscriptions ADD COLUMN discount numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_discount
        CHECK (discount >= 0 AND discount <= offer_price);

      ALTER TABLE subscriptions ADD COLUMN total_price numeric(14,2)
        GENERATED ALWAYS AS (offer_price - discount) STORED;

      COMMENT ON COLUMN subscriptions.offer_price IS 'Prix de l''offre figé à la souscription, par période';
      COMMENT ON COLUMN subscriptions.discount IS 'Remise en montant, dans la devise de la souscription';
      COMMENT ON COLUMN subscriptions.total_price IS 'Tarif appliqué = offer_price − discount (colonne générée)';
    `)
  }

  async down() {
    this.schema.raw(`
      ALTER TABLE subscriptions DROP COLUMN total_price;
      ALTER TABLE subscriptions DROP CONSTRAINT ck_subscriptions_discount;
      ALTER TABLE subscriptions DROP COLUMN discount;
      ALTER TABLE subscriptions RENAME CONSTRAINT ck_subscriptions_offer_price TO ck_subscriptions_unit_price;
      ALTER TABLE subscriptions RENAME COLUMN offer_price TO unit_price;
      COMMENT ON COLUMN subscriptions.unit_price IS 'Tarif appliqué, par véhicule et par période de l''offre';
    `)
  }
}
