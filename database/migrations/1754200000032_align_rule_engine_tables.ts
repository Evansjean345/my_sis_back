import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  MOTEUR DE RÈGLES — zones, politiques de vitesse, règles
 * =========================================================================
 *
 * Aligne les tables du moteur (migrations 004 et 005, encore inutilisées)
 * sur le référentiel du tableau de bord (spécifications §III.2 / §III.3) :
 *
 * ① ZONES (`geofences`) : l'alerte d'entrée / de sortie se règle sur la zone
 *   (`alert_on_entry`, `alert_on_exit`) ; les véhicules surveillés restent
 *   dans `geofence_assignments` (aucun = tous ceux du client).
 *
 * ② POLITIQUES DE VITESSE (`speed_policies`, nouvelle) : globale, sur une
 *   zone ou sur des véhicules (`speed_policy_vehicles`) ; limite, tolérance,
 *   durée minimale de dépassement, gravité, bridage.
 *
 * ③ RÈGLES (`policies`) : déclencheurs et gravités du référentiel
 *   (13 événements ; critical / high / medium / low), conditions en tableau
 *   jsonb, actions alert / notify / incident / command (`policy_actions`).
 *   `policy_targets` reste l'index « quelles règles pour ce véhicule ? »,
 *   dérivé des cibles des conditions.
 *
 * Aucune suppression physique : zones, politiques et règles se désactivent.
 * Les tables étant vides, les contraintes sont remplacées sans conversion.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE geofences
        ADD COLUMN alert_on_entry boolean NOT NULL DEFAULT false,
        ADD COLUMN alert_on_exit  boolean NOT NULL DEFAULT true;
      ALTER TABLE geofences ADD CONSTRAINT ck_geofences_alert
        CHECK (alert_on_entry OR alert_on_exit);
    `)

    this.schema.raw(`
      CREATE TABLE speed_policies (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name                 text NOT NULL,
        scope                text NOT NULL DEFAULT 'global',
        geofence_id          uuid REFERENCES geofences (id) ON DELETE RESTRICT,
        limit_kph            smallint NOT NULL,
        tolerance_kph        smallint NOT NULL DEFAULT 0,
        min_duration_seconds integer NOT NULL DEFAULT 0,
        severity             text NOT NULL DEFAULT 'medium',
        limiter_enabled      boolean NOT NULL DEFAULT false,
        is_active            boolean NOT NULL DEFAULT true,
        created_by           uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        deleted_at           timestamptz,
        CONSTRAINT ck_speed_policies_scope CHECK (scope IN ('global','zone','vehicle')),
        CONSTRAINT ck_speed_policies_zone CHECK ((scope = 'zone') = (geofence_id IS NOT NULL)),
        CONSTRAINT ck_speed_policies_limit CHECK (limit_kph BETWEEN 5 AND 200),
        CONSTRAINT ck_speed_policies_tolerance CHECK (tolerance_kph BETWEEN 0 AND 50),
        CONSTRAINT ck_speed_policies_duration CHECK (min_duration_seconds BETWEEN 0 AND 3600),
        CONSTRAINT ck_speed_policies_severity CHECK (severity IN ('critical','high','medium','low'))
      );
      CREATE UNIQUE INDEX uq_speed_policies_org_name ON speed_policies (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_speed_policies_org_active ON speed_policies (organization_id)
        WHERE is_active AND deleted_at IS NULL;
      CREATE TRIGGER trg_speed_policies_updated_at BEFORE UPDATE ON speed_policies
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();

      CREATE TABLE speed_policy_vehicles (
        speed_policy_id uuid NOT NULL REFERENCES speed_policies (id) ON DELETE CASCADE,
        vehicle_id      uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
        PRIMARY KEY (speed_policy_id, vehicle_id)
      );
      CREATE INDEX idx_speed_policy_vehicles_vehicle ON speed_policy_vehicles (vehicle_id);
    `)

    this.schema.raw(`
      ALTER TABLE policies DROP CONSTRAINT ck_policies_trigger;
      ALTER TABLE policies ADD CONSTRAINT ck_policies_trigger CHECK (trigger_type IN (
        'overspeed','geofence_exit','geofence_entry','schedule_violation','power_cut',
        'disconnection','sos','jamming','towing','tamper','harsh_driving',
        'engine_start','engine_stop'
      ));
      ALTER TABLE policies DROP CONSTRAINT ck_policies_severity;
      ALTER TABLE policies ALTER COLUMN severity SET DEFAULT 'medium';
      ALTER TABLE policies ADD CONSTRAINT ck_policies_severity
        CHECK (severity IN ('critical','high','medium','low'));
      ALTER TABLE policies ALTER COLUMN conditions SET DEFAULT '[]'::jsonb;
      ALTER TABLE policies ADD CONSTRAINT ck_policies_conditions
        CHECK (jsonb_typeof(conditions) = 'array');

      ALTER TABLE policy_actions DROP CONSTRAINT ck_policy_actions_type;
      ALTER TABLE policy_actions ADD CONSTRAINT ck_policy_actions_type
        CHECK (action_type IN ('alert','notify','incident','command'));
    `)
  }

  async down() {
    this.schema.raw(`
      DELETE FROM policy_actions;
      DELETE FROM policies;
      ALTER TABLE policy_actions DROP CONSTRAINT ck_policy_actions_type;
      ALTER TABLE policy_actions ADD CONSTRAINT ck_policy_actions_type CHECK (action_type IN (
        'notify', 'create_incident', 'webhook', 'immobilize', 'log_only'
      ));
      ALTER TABLE policies DROP CONSTRAINT ck_policies_conditions;
      ALTER TABLE policies ALTER COLUMN conditions SET DEFAULT '{}'::jsonb;
      ALTER TABLE policies DROP CONSTRAINT ck_policies_severity;
      ALTER TABLE policies ALTER COLUMN severity SET DEFAULT 'warning';
      ALTER TABLE policies ADD CONSTRAINT ck_policies_severity
        CHECK (severity IN ('info','warning','critical'));
      ALTER TABLE policies DROP CONSTRAINT ck_policies_trigger;
      ALTER TABLE policies ADD CONSTRAINT ck_policies_trigger CHECK (trigger_type IN (
        'overspeed','geofence_enter','geofence_exit','schedule_violation','ignition_on',
        'ignition_off','unauthorized_start','prolonged_stop','harsh_driving','power_cut',
        'low_battery','sos','device_offline','towing'
      ));

      DROP TABLE IF EXISTS speed_policy_vehicles;
      DROP TABLE IF EXISTS speed_policies;

      ALTER TABLE geofences DROP CONSTRAINT IF EXISTS ck_geofences_alert;
      ALTER TABLE geofences DROP COLUMN IF EXISTS alert_on_exit;
      ALTER TABLE geofences DROP COLUMN IF EXISTS alert_on_entry;
    `)
  }
}
