import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  OFFRES PRÉDÉFINIES — Standard, Gold, Premium, Platinum
 * =========================================================================
 *
 * Données de référence présentes dans TOUS les environnements, d'où une
 * migration plutôt qu'un seeder. Les offres naissent INACTIVES, au prix de 0,
 * sans limite de véhicules et avec 30 jours d'historique : prix, limite,
 * historique et date de commercialisation se règlent depuis le Super Admin
 * avant activation. Idempotent : un code déjà pris (offre vivante) est conservé tel
 * quel.
 *
 * Fonctionnalités par défaut (clés de `app/domain/billing/offer_policy.ts`) :
 *   STANDARD : fleet, alerts
 *   GOLD     : fleet, zones, drivers, incidents, support, speed, alerts
 *   PREMIUM  : fleet, zones, drivers, incidents, speed, alerts
 *   PLATINUM : fleet, zones, drivers, incidents, support, speed, alerts
 */
const CODES = ['STANDARD', 'GOLD', 'PREMIUM', 'PLATINUM']

export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      INSERT INTO offers (code, name, description, price, periodicity, gps_history_days, features)
      VALUES
        ('STANDARD', 'Standard', 'Suivi en temps réel et alertes SMS.',
          0, 'monthly', 30, ARRAY['fleet','alerts']),
        ('GOLD', 'Gold', 'Toutes les fonctionnalités, technicien dédié compris.',
          0, 'monthly', 30,
          ARRAY['fleet','zones','drivers','incidents','support','speed','alerts']),
        ('PREMIUM', 'Premium', 'Toutes les fonctionnalités, hors technicien dédié.',
          0, 'monthly', 30,
          ARRAY['fleet','zones','drivers','incidents','speed','alerts']),
        ('PLATINUM', 'Platinum', 'Toutes les fonctionnalités, technicien dédié compris.',
          0, 'monthly', 30,
          ARRAY['fleet','zones','drivers','incidents','support','speed','alerts'])
      ON CONFLICT (code) WHERE deleted_at IS NULL DO NOTHING;
    `)
  }

  async down() {
    // Seules les offres prédéfinies jamais rattachées sont retirées.
    const codes = CODES.map((c) => `'${c}'`).join(', ')
    this.schema.raw(`
      DELETE FROM offers o
      WHERE o.code IN (${codes})
        AND NOT EXISTS (SELECT 1 FROM offer_organizations l WHERE l.offer_id = o.id)
    `)
  }
}
