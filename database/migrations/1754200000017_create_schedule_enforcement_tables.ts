import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  IMMOBILISATION PLANIFIÉE — calendriers d'utilisation appliqués au moteur
 * =========================================================================
 *
 * Les tables `usage_schedules`, `schedule_windows` et `vehicle_schedules`
 * (migration 005) décrivent QUAND un véhicule peut rouler. Cette migration
 * ajoute ce qu'il faut pour que la plateforme AGISSE sur ce calendrier :
 *
 * ① vehicle_schedule_groups
 *   Rattache un calendrier à un GROUPE de véhicules. Un véhicule hérite des
 *   calendriers de tous ses groupes, en plus des siens (vehicle_schedules).
 *   Ajouter un véhicule au groupe « Livraison de nuit » suffit à lui appliquer
 *   le calendrier du groupe : rien à refaire véhicule par véhicule.
 *
 * ② vehicle_schedule_states
 *   Mémoire du moteur d'application (`node ace sisbm:schedules:enforce`).
 *   Sans elle, le moteur ne raisonnerait que sur l'instant présent et
 *   renverrait une coupure à chaque passage. Avec elle, il agit sur les
 *   TRANSITIONS (entrée / sortie de plage), relance tant que l'objectif n'est
 *   pas atteint (véhicule encore en mouvement : CM-07), et respecte une
 *   dérogation posée à la main par un opérateur.
 *
 * ③ device_commands.origin accepte `schedule`
 *   L'audit doit dire QUI a coupé le moteur : un opérateur (`manual`), une
 *   politique (`policy`), une intégration (`api`) ou un calendrier
 *   (`schedule`). C'est aussi ce qui permet au moteur de ne rétablir QUE ce
 *   qu'il a lui-même coupé — jamais une immobilisation manuelle (vol).
 *
 * ④ Cloisonnement par trigger
 *   Un calendrier, le véhicule ou le groupe auquel il s'applique doivent
 *   appartenir à la même organisation. Non exprimable en FK (la règle
 *   traverse deux tables), tenu par le dépôt applicatif ET par la base.
 */
export default class extends BaseSchema {
  async up() {
    // ------------------------------------------------------------- ① calendrier ↔ groupe
    this.schema.raw(`
      CREATE TABLE vehicle_schedule_groups (
        vehicle_group_id  uuid NOT NULL REFERENCES vehicle_groups (id) ON DELETE CASCADE,
        usage_schedule_id uuid NOT NULL REFERENCES usage_schedules (id) ON DELETE CASCADE,
        mode              text NOT NULL DEFAULT 'allowed',
        created_at        timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vehicle_group_id, usage_schedule_id),
        CONSTRAINT ck_vehicle_schedule_groups_mode CHECK (mode IN ('allowed','forbidden'))
      );
      CREATE INDEX idx_vehicle_schedule_groups_schedule ON vehicle_schedule_groups (usage_schedule_id);

      -- recherche inverse « quels véhicules suivent ce calendrier ? »
      CREATE INDEX idx_vehicle_schedules_schedule ON vehicle_schedules (usage_schedule_id);
    `)

    // ------------------------------------------------------------- ② état du moteur
    this.schema.raw(`
      CREATE TABLE vehicle_schedule_states (
        vehicle_id       uuid PRIMARY KEY REFERENCES vehicles (id) ON DELETE CASCADE,
        organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        desired_state    text NOT NULL,
        cause            text NOT NULL,
        usage_schedule_id uuid REFERENCES usage_schedules (id) ON DELETE SET NULL,
        pending_action   text,
        pending_since    timestamptz,
        next_attempt_at  timestamptz,
        attempts         integer NOT NULL DEFAULT 0,
        last_error_code  text,
        last_error_message text,
        last_command_id  uuid REFERENCES device_commands (id) ON DELETE SET NULL,
        last_outcome     text,
        evaluated_at     timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_vehicle_schedule_states_desired CHECK (desired_state IN ('free','immobilized')),
        CONSTRAINT ck_vehicle_schedule_states_pending CHECK (pending_action IS NULL OR pending_action IN ('cut','restore')),
        CONSTRAINT ck_vehicle_schedule_states_since   CHECK ((pending_action IS NULL) = (pending_since IS NULL)),
        CONSTRAINT ck_vehicle_schedule_states_attempts CHECK (attempts >= 0)
      );
      CREATE INDEX idx_vehicle_schedule_states_org ON vehicle_schedule_states (organization_id);
      CREATE INDEX idx_vehicle_schedule_states_pending ON vehicle_schedule_states (next_attempt_at)
        WHERE pending_action IS NOT NULL;
      CREATE TRIGGER trg_vehicle_schedule_states_updated_at BEFORE UPDATE ON vehicle_schedule_states
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    // ------------------------------------------------------------- ③ origine `schedule`
    this.schema.raw(`
      ALTER TABLE device_commands DROP CONSTRAINT ck_device_commands_origin;
      ALTER TABLE device_commands
        ADD CONSTRAINT ck_device_commands_origin CHECK (origin IN ('manual','policy','api','schedule'));
      -- lecture « dernière commande moteur du véhicule », faite à chaque passage du moteur
      CREATE INDEX idx_device_commands_vehicle_engine ON device_commands (vehicle_id, requested_at DESC)
        WHERE command_type IN ('engine_cut','engine_restore');
    `)

    // ------------------------------------------------------------- ④ cloisonnement
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_check_schedule_assignment_tenant()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        org_calendrier uuid;
        org_cible      uuid;
      BEGIN
        SELECT organization_id INTO org_calendrier FROM usage_schedules WHERE id = NEW.usage_schedule_id;
        IF TG_TABLE_NAME = 'vehicle_schedules' THEN
          SELECT organization_id INTO org_cible FROM vehicles WHERE id = NEW.vehicle_id;
        ELSE
          SELECT organization_id INTO org_cible FROM vehicle_groups WHERE id = NEW.vehicle_group_id;
        END IF;

        IF org_calendrier IS DISTINCT FROM org_cible THEN
          RAISE EXCEPTION 'CM-17 : le calendrier (%) et sa cible (%) appartiennent a des organisations differentes',
            org_calendrier, org_cible
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER trg_vehicle_schedules_tenant
        BEFORE INSERT OR UPDATE ON vehicle_schedules
        FOR EACH ROW EXECUTE FUNCTION sisbm_check_schedule_assignment_tenant();

      CREATE TRIGGER trg_vehicle_schedule_groups_tenant
        BEFORE INSERT OR UPDATE ON vehicle_schedule_groups
        FOR EACH ROW EXECUTE FUNCTION sisbm_check_schedule_assignment_tenant();
    `)
  }

  async down() {
    this.schema.raw('DROP TRIGGER IF EXISTS trg_vehicle_schedules_tenant ON vehicle_schedules')
    this.schema.raw('DROP TABLE IF EXISTS vehicle_schedule_groups')
    this.schema.raw('DROP FUNCTION IF EXISTS sisbm_check_schedule_assignment_tenant()')
    this.schema.raw('DROP TABLE IF EXISTS vehicle_schedule_states')
    this.schema.raw('DROP INDEX IF EXISTS idx_vehicle_schedules_schedule')
    this.schema.raw('DROP INDEX IF EXISTS idx_device_commands_vehicle_engine')
    /**
     * Les commandes d'origine `schedule` deviennent `policy` : c'est la plus
     * proche (décision automatique), et la contrainte d'origine doit pouvoir
     * être reposée. La reprise est tracée dans device_command_logs.
     */
    this.schema.raw(`
      INSERT INTO device_command_logs (command_id, status_from, status_to, actor_type, note, payload)
      SELECT id, status, status, 'system',
             'Rollback migration 017 : origine schedule reprise en policy',
             jsonb_build_object('migration', '1754200000017_create_schedule_enforcement_tables')
        FROM device_commands WHERE origin = 'schedule';
      UPDATE device_commands SET origin = 'policy' WHERE origin = 'schedule';
      ALTER TABLE device_commands DROP CONSTRAINT ck_device_commands_origin;
      ALTER TABLE device_commands
        ADD CONSTRAINT ck_device_commands_origin CHECK (origin IN ('manual','policy','api'));
    `)
  }
}
