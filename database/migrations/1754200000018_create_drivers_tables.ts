import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  CONDUCTEURS ET GROUPES DE CONDUCTEURS
 * =========================================================================
 *
 * ① drivers
 *   Un conducteur appartient à UNE organisation et peut être rattaché à un
 *   véhicule (`vehicle_id`, facultatif). Plusieurs conducteurs peuvent
 *   partager un véhicule (équipes de jour / de nuit) : aucune unicité sur
 *   `vehicle_id`. L'historique des rattachements se lit dans le journal
 *   d'audit (avant / après de chaque changement).
 *
 *   `full_name` est une colonne GÉNÉRÉE : elle sert de libellé dans les
 *   listes de membres de groupe et de cible à la recherche floue (pg_trgm),
 *   sans risque de divergence avec prénom + nom.
 *
 * ② driver_groups / driver_group_members
 *   Symétriques de `vehicle_groups` / `device_groups` (migrations 003 et 013) :
 *   mêmes conventions, même suppression logique, même contrôleur commun côté
 *   API. Un conducteur peut appartenir à plusieurs groupes.
 *
 * ③ Cloisonnement par trigger
 *   - un conducteur et son véhicule appartiennent à la même organisation ;
 *   - un membre et son groupe aussi : `sisbm_check_group_member_tenant()`
 *     (migration 013) gagne une troisième branche.
 */

/** Corps du trigger de cloisonnement des groupes, version 013 (restaurée au rollback). */
const GROUP_TENANT_FUNCTION_013 = `
  CREATE OR REPLACE FUNCTION sisbm_check_group_member_tenant()
  RETURNS trigger
  LANGUAGE plpgsql AS $$
  DECLARE
    org_groupe uuid;
    org_membre uuid;
  BEGIN
    IF TG_TABLE_NAME = 'device_group_members' THEN
      SELECT organization_id INTO org_groupe FROM device_groups WHERE id = NEW.device_group_id;
      SELECT organization_id INTO org_membre FROM devices        WHERE id = NEW.device_id;
    ELSE
      SELECT organization_id INTO org_groupe FROM vehicle_groups WHERE id = NEW.vehicle_group_id;
      SELECT organization_id INTO org_membre FROM vehicles       WHERE id = NEW.vehicle_id;
    END IF;

    IF org_groupe IS DISTINCT FROM org_membre THEN
      RAISE EXCEPTION 'CM-17 : le membre (%) et le groupe (%) appartiennent a des organisations differentes',
        org_membre, org_groupe
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END $$;
`

export default class extends BaseSchema {
  async up() {
    // ------------------------------------------------------------- ① conducteurs
    this.schema.raw(`
      CREATE TABLE drivers (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        vehicle_id         uuid REFERENCES vehicles (id) ON DELETE SET NULL,
        first_name         text NOT NULL,
        last_name          text NOT NULL,
        full_name          text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
        phone              text,
        email              citext,
        employee_code      text,
        license_number     text,
        license_categories text[] NOT NULL DEFAULT '{}',
        license_expires_on date,
        status             text NOT NULL DEFAULT 'active',
        notes              text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        deleted_at         timestamptz,
        CONSTRAINT ck_drivers_status CHECK (status IN ('active','inactive','suspended')),
        CONSTRAINT ck_drivers_names  CHECK (length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0),
        CONSTRAINT ck_drivers_phone  CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$'),
        CONSTRAINT ck_drivers_email  CHECK (email IS NULL OR email ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
      );
      CREATE UNIQUE INDEX uq_drivers_org_license ON drivers (organization_id, license_number)
        WHERE license_number IS NOT NULL AND deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_drivers_org_employee_code ON drivers (organization_id, employee_code)
        WHERE employee_code IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX idx_drivers_org_status ON drivers (organization_id, status) WHERE deleted_at IS NULL;
      CREATE INDEX idx_drivers_vehicle ON drivers (vehicle_id) WHERE vehicle_id IS NOT NULL;
      CREATE INDEX idx_drivers_full_name_trgm ON drivers USING gin (full_name gin_trgm_ops);
      CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();
    `)

    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_check_driver_vehicle_tenant()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        org_vehicule uuid;
      BEGIN
        IF NEW.vehicle_id IS NULL THEN
          RETURN NEW;
        END IF;
        SELECT organization_id INTO org_vehicule FROM vehicles WHERE id = NEW.vehicle_id;
        IF org_vehicule IS DISTINCT FROM NEW.organization_id THEN
          RAISE EXCEPTION 'CM-17 : le conducteur (%) et le vehicule (%) appartiennent a des organisations differentes',
            NEW.organization_id, org_vehicule
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER trg_drivers_vehicle_tenant
        BEFORE INSERT OR UPDATE OF vehicle_id, organization_id ON drivers
        FOR EACH ROW EXECUTE FUNCTION sisbm_check_driver_vehicle_tenant();
    `)

    // ------------------------------------------------------------- ② groupes de conducteurs
    this.schema.raw(`
      CREATE TABLE driver_groups (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        name            text NOT NULL,
        description     text,
        color           text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        CONSTRAINT ck_driver_groups_color CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')
      );
      CREATE UNIQUE INDEX uq_driver_groups_org_name ON driver_groups (organization_id, lower(name))
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_driver_groups_organization ON driver_groups (organization_id)
        WHERE deleted_at IS NULL;
      CREATE TRIGGER trg_driver_groups_updated_at BEFORE UPDATE ON driver_groups
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();

      CREATE TABLE driver_group_members (
        driver_group_id uuid NOT NULL REFERENCES driver_groups (id) ON DELETE CASCADE,
        driver_id       uuid NOT NULL REFERENCES drivers (id) ON DELETE CASCADE,
        added_at        timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (driver_group_id, driver_id)
      );
      CREATE INDEX idx_driver_group_members_driver ON driver_group_members (driver_id);
    `)

    // ------------------------------------------------------------- ③ cloisonnement des membres
    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_check_group_member_tenant()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        org_groupe uuid;
        org_membre uuid;
      BEGIN
        IF TG_TABLE_NAME = 'device_group_members' THEN
          SELECT organization_id INTO org_groupe FROM device_groups WHERE id = NEW.device_group_id;
          SELECT organization_id INTO org_membre FROM devices        WHERE id = NEW.device_id;
        ELSIF TG_TABLE_NAME = 'driver_group_members' THEN
          SELECT organization_id INTO org_groupe FROM driver_groups  WHERE id = NEW.driver_group_id;
          SELECT organization_id INTO org_membre FROM drivers        WHERE id = NEW.driver_id;
        ELSE
          SELECT organization_id INTO org_groupe FROM vehicle_groups WHERE id = NEW.vehicle_group_id;
          SELECT organization_id INTO org_membre FROM vehicles       WHERE id = NEW.vehicle_id;
        END IF;

        IF org_groupe IS DISTINCT FROM org_membre THEN
          RAISE EXCEPTION 'CM-17 : le membre (%) et le groupe (%) appartiennent a des organisations differentes',
            org_membre, org_groupe
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER trg_driver_group_members_tenant
        BEFORE INSERT OR UPDATE ON driver_group_members
        FOR EACH ROW EXECUTE FUNCTION sisbm_check_group_member_tenant();
    `)
  }

  async down() {
    this.schema.raw('DROP TABLE IF EXISTS driver_group_members')
    this.schema.raw('DROP TABLE IF EXISTS driver_groups')
    this.schema.raw(GROUP_TENANT_FUNCTION_013)
    this.schema.raw('DROP TABLE IF EXISTS drivers')
    this.schema.raw('DROP FUNCTION IF EXISTS sisbm_check_driver_vehicle_tenant()')
  }
}
