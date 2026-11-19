import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  CATALOGUE DES FONCTIONNALITÉS — fonctionnalités et sous-fonctionnalités
 * =========================================================================
 *
 * Le catalogue quitte le code (`offers.features text[]` + contrainte CHECK)
 * pour trois tables, sur le modèle du menu du tableau de bord :
 *
 *   features            une FONCTIONNALITÉ : un nom (« Contrôle de vitesse »)
 *   sub_features        ses SOUS-FONCTIONNALITÉS : clé, libellé, page ouverte
 *   offer_sub_features  sous-fonctionnalités incluses dans chaque offre
 *
 * Les identifiants sont des entiers croissants : l'ordre d'insertion est
 * l'ordre d'affichage (fonctionnalités, puis sous-fonctionnalités).
 * Deux sous-fonctionnalités peuvent ouvrir la même page (alertes et
 * limiteur de vitesse → /dashboard/speed) : la page est visible si l'une
 * des deux est incluse.
 *
 * Reprise des offres existantes (clés de la migration 025) :
 *   fleet, schedules, zones, rules, drivers, driver_groups, incidents → même clé
 *   speed → speed_alerts · alerts, sms → alerts_sms · support → support_technician
 *   notifications, notification_templates, vehicle_groups → sans équivalent, retirées
 * Une offre n'ouvre jamais plus que ce qui a été vendu : les nouvelles
 * sous-fonctionnalités ne sont incluses dans aucune offre existante.
 */
const CATALOGUE: [string, string, string, string][] = [
  // fonctionnalité, clé, libellé, page
  ['Supervision', 'fleet', 'Supervision', '/dashboard/fleet'],
  ['Horaires', 'schedules', 'Gestion des horaires', '/dashboard/clock'],
  ['Zones', 'zones', 'Zones géographiques', '/dashboard/zones'],
  ['Contrôle de vitesse', 'speed_alerts', 'Alertes de vitesse', '/dashboard/speed'],
  ['Contrôle de vitesse', 'speed_limiter', 'Limiteur de vitesse', '/dashboard/speed'],
  ['Moteur de règles', 'rules', 'Moteur de règles', '/dashboard/rules'],
  ['Alertes et notifications', 'alerts_sms', 'Alertes SMS', '/dashboard/alertes-sms'],
  ['Alertes et notifications', 'alerts_email', 'Alertes e-mail', '/dashboard/alertes-email'],
  ['Conducteurs', 'drivers', 'Gestion des conducteurs', '/dashboard/driver'],
  ['Conducteurs', 'driver_groups', 'Équipes de conducteurs', '/dashboard/group_driver'],
  ['Incidents', 'incidents', 'Gestion des incidents', '/dashboard/incidents'],
  ['Rapports', 'reports_standard', 'Rapports standards', '/dashboard/rapports-standards'],
  ['Rapports', 'reports_custom', 'Rapports personnalisés', '/dashboard/rapports-personnalises'],
  ['Support', 'support_technician', 'Technicien dédié', '/dashboard/support-tech'],
]

/** Ancienne clé (migration 025) → nouvelle sous-fonctionnalité. */
const REPRISE: [string, string][] = [
  ['fleet', 'fleet'],
  ['schedules', 'schedules'],
  ['zones', 'zones'],
  ['speed', 'speed_alerts'],
  ['rules', 'rules'],
  ['alerts', 'alerts_sms'],
  ['sms', 'alerts_sms'],
  ['drivers', 'drivers'],
  ['driver_groups', 'driver_groups'],
  ['incidents', 'incidents'],
  ['support', 'support_technician'],
]

/** Clés acceptées par `ck_offers_features` (migration 025), pour le retour arrière. */
const CLES_025 = [
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

const q = (s: string) => `'${s.replaceAll("'", "''")}'`

export default class extends BaseSchema {
  async up() {
    const noms = [...new Set(CATALOGUE.map(([nom]) => nom))]
    const sous = CATALOGUE.map(
      ([nom, cle, libelle, page], i) => `(${i}, ${q(nom)}, ${q(cle)}, ${q(libelle)}, ${q(page)})`
    ).join(',\n        ')
    const reprise = REPRISE.map(([avant, apres]) => `(${q(avant)}, ${q(apres)})`).join(', ')

    this.schema.raw(`
      CREATE TABLE features (
        id   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name text NOT NULL,
        CONSTRAINT ck_features_name CHECK (length(btrim(name)) > 0)
      );
      CREATE UNIQUE INDEX uq_features_name ON features (lower(name));
      COMMENT ON TABLE features IS 'Fonctionnalités vendables (modules du menu) — un nom, des sous-fonctionnalités';

      CREATE TABLE sub_features (
        id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        feature_id smallint NOT NULL REFERENCES features (id) ON DELETE CASCADE,
        key        text NOT NULL,
        label      text NOT NULL,
        path       text NOT NULL,
        CONSTRAINT uq_sub_features_key UNIQUE (key),
        CONSTRAINT ck_sub_features_key   CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
        CONSTRAINT ck_sub_features_label CHECK (length(btrim(label)) > 0),
        CONSTRAINT ck_sub_features_path  CHECK (path ~ '^/dashboard/[a-z0-9_/-]+$')
      );
      CREATE INDEX idx_sub_features_feature ON sub_features (feature_id);
      COMMENT ON TABLE sub_features IS 'Sous-fonctionnalités : chacune ouvre une page du tableau de bord du distributeur';

      CREATE TABLE offer_sub_features (
        offer_id       uuid NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
        sub_feature_id smallint NOT NULL REFERENCES sub_features (id) ON DELETE CASCADE,
        PRIMARY KEY (offer_id, sub_feature_id)
      );
      CREATE INDEX idx_offer_sub_features_sub_feature ON offer_sub_features (sub_feature_id);

      INSERT INTO features (name)
      SELECT v.name FROM (VALUES ${noms.map((n, i) => `(${i}, ${q(n)})`).join(', ')}) AS v(ord, name)
      ORDER BY v.ord;

      INSERT INTO sub_features (feature_id, key, label, path)
      SELECT f.id, v.key, v.label, v.path
      FROM (VALUES
        ${sous}
      ) AS v(ord, feature, key, label, path)
      JOIN features f ON f.name = v.feature
      ORDER BY v.ord;

      INSERT INTO offer_sub_features (offer_id, sub_feature_id)
      SELECT DISTINCT o.id, s.id
      FROM offers o
      CROSS JOIN LATERAL unnest(o.features) AS k(cle)
      JOIN (VALUES ${reprise}) AS r(avant, apres) ON r.avant = k.cle
      JOIN sub_features s ON s.key = r.apres;

      ALTER TABLE offers DROP COLUMN features;
    `)
  }

  async down() {
    // Retour à `offers.features text[]` (migration 025) : correspondance inverse.
    const inverse = REPRISE.filter(([avant]) => avant !== 'sms')
      .map(([avant, apres]) => `(${q(apres)}, ${q(avant)})`)
      .concat([`('speed_limiter', 'speed')`])
      .join(', ')
    this.schema.raw(`
      ALTER TABLE offers ADD COLUMN features text[] NOT NULL DEFAULT '{}';

      UPDATE offers o SET features = sub.cles
      FROM (
        SELECT l.offer_id, array_agg(DISTINCT r.avant) AS cles
        FROM offer_sub_features l
        JOIN sub_features s ON s.id = l.sub_feature_id
        JOIN (VALUES ${inverse}) AS r(apres, avant) ON r.apres = s.key
        GROUP BY l.offer_id
      ) sub
      WHERE sub.offer_id = o.id;

      ALTER TABLE offers ADD CONSTRAINT ck_offers_features
        CHECK (features <@ ARRAY[${CLES_025.map(q).join(',')}]::text[]);

      DROP TABLE offer_sub_features;
      DROP TABLE sub_features;
      DROP TABLE features;
    `)
  }
}
