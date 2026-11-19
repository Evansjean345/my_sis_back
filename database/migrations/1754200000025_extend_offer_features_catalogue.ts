import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  OFFRES — catalogue de fonctionnalités par module
 * =========================================================================
 *
 * Le catalogue passe de 7 fonctionnalités à 14, rangées par module comme le
 * menu du tableau de bord (`app/domain/billing/offer_policy.ts`) :
 *
 *   Supervision              fleet
 *   Alertes & Notifications  alerts, notifications, sms, notification_templates
 *   Gestion des incidents    incidents
 *   Rubriques client         schedules, zones, speed, rules, drivers,
 *                            driver_groups, vehicle_groups
 *   Support                  support
 *
 * Les 7 clés existantes sont conservées : aucune offre n'est modifiée. Les
 * nouvelles fonctionnalités ne sont incluses dans AUCUNE offre tant qu'on ne
 * les coche pas (matrice des fonctionnalités du Super Admin) — une offre
 * n'ouvre jamais plus que ce qui a été vendu.
 */
const AVANT = ['fleet', 'zones', 'drivers', 'incidents', 'support', 'speed', 'alerts']
const APRES = [
  'fleet',
  'alerts',
  'notifications',
  'sms',
  'notification_templates',
  'incidents',
  'schedules',
  'zones',
  'speed',
  'rules',
  'drivers',
  'driver_groups',
  'vehicle_groups',
  'support',
]

const liste = (cles: string[]) => cles.map((c) => `'${c}'`).join(',')

export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE offers DROP CONSTRAINT ck_offers_features;
      ALTER TABLE offers ADD CONSTRAINT ck_offers_features
        CHECK (features <@ ARRAY[${liste(APRES)}]::text[]);
    `)
  }

  async down() {
    // Les nouvelles clés sont retirées des offres avant de restaurer l'ancienne contrainte.
    this.schema.raw(`
      UPDATE offers SET features = ARRAY(
        SELECT f FROM unnest(features) AS f WHERE f = ANY (ARRAY[${liste(AVANT)}]::text[])
      )
      WHERE NOT features <@ ARRAY[${liste(AVANT)}]::text[];

      ALTER TABLE offers DROP CONSTRAINT ck_offers_features;
      ALTER TABLE offers ADD CONSTRAINT ck_offers_features
        CHECK (features <@ ARRAY[${liste(AVANT)}]::text[]);
    `)
  }
}
