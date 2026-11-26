import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  PLAGES HORAIRES — application 100 % automatique
 * =========================================================================
 *
 * Référentiel : `domain/scheduling/code_legacy/schedule`.
 *
 * ① Plus de mode « interdit »
 *   Un calendrier ne liste que des plages AUTORISÉES : le véhicule est coupé
 *   dès qu'il en sort. Les rattachements `forbidden` (véhicules et flottes)
 *   sont supprimés — les convertir en `allowed` inverserait leur sens — puis
 *   la colonne `mode` disparaît des deux tables. Au passage suivant, le
 *   moteur rétablit les véhicules qu'un calendrier interdit avait coupés
 *   (jamais une coupure manuelle). Nombre supprimé : NOTICE.
 *
 * ② Plus de dérogation opérateur
 *   Le moteur ne tient plus compte d'une commande manuelle passée après une
 *   coupure planifiée : il recoupe. Les événements `overridden` du journal
 *   sont supprimés et le type d'événement disparaît.
 *
 * ③ Mémoire du moteur alignée sur le référentiel
 *   `cause` et `last_outcome` de `vehicle_schedule_states` reçoivent leur
 *   CHECK ; les valeurs retirées sont reprises (recalculées au passage suivant).
 *
 * ④ Fin de la double validation
 *   `policies.requires_human_validation` n'était plus lue (migration 016) :
 *   la colonne est retirée.
 */
const EVENT_KINDS = `'transition','dispatched','refused','completed','manual_cut_kept','already_immobilized'`
const CAUSES = `'no_schedule','inside_allowed_window','outside_allowed_windows'`
const OUTCOMES = `'idle','dispatch','waiting_in_flight','waiting_retry','completed',
  'manual_cut_kept','already_immobilized'`

export default class extends BaseSchema {
  async up() {
    // ------------------------------------------------------------- ① mode interdit
    this.schema.raw(`
      DO $$
      DECLARE vehicules integer; flottes integer;
      BEGIN
        DELETE FROM vehicle_schedules WHERE mode = 'forbidden';
        GET DIAGNOSTICS vehicules = ROW_COUNT;
        DELETE FROM vehicle_schedule_groups WHERE mode = 'forbidden';
        GET DIAGNOSTICS flottes = ROW_COUNT;
        RAISE NOTICE 'rattachements « interdit » supprimés : % véhicule(s), % flotte(s)', vehicules, flottes;
      END $$;

      ALTER TABLE vehicle_schedules DROP CONSTRAINT ck_vehicle_schedules_mode, DROP COLUMN mode;
      ALTER TABLE vehicle_schedule_groups DROP CONSTRAINT ck_vehicle_schedule_groups_mode, DROP COLUMN mode;
    `)

    // ------------------------------------------------------------- ② dérogation opérateur
    this.schema.raw(`
      DO $$
      DECLARE removed integer;
      BEGIN
        DELETE FROM schedule_enforcement_events WHERE kind = 'overridden';
        GET DIAGNOSTICS removed = ROW_COUNT;
        RAISE NOTICE 'événements « dérogation opérateur » supprimés du journal : %', removed;
      END $$;

      ALTER TABLE schedule_enforcement_events DROP CONSTRAINT ck_schedule_events_kind;
      ALTER TABLE schedule_enforcement_events
        ADD CONSTRAINT ck_schedule_events_kind CHECK (kind IN (${EVENT_KINDS}));
    `)

    // ------------------------------------------------------------- ③ mémoire du moteur
    this.schema.raw(`
      UPDATE vehicle_schedule_states SET cause = 'no_schedule'
       WHERE cause NOT IN (${CAUSES});
      UPDATE vehicle_schedule_states SET last_outcome = 'idle'
       WHERE last_outcome IS NOT NULL AND last_outcome NOT IN (${OUTCOMES});

      ALTER TABLE vehicle_schedule_states
        ADD CONSTRAINT ck_vehicle_schedule_states_cause CHECK (cause IN (${CAUSES})),
        ADD CONSTRAINT ck_vehicle_schedule_states_outcome
          CHECK (last_outcome IS NULL OR last_outcome IN (${OUTCOMES}));
    `)

    // ------------------------------------------------------------- ④ double validation
    this.schema.raw('ALTER TABLE policies DROP COLUMN IF EXISTS requires_human_validation')
  }

  /** Les rattachements et événements supprimés ne sont pas restaurés. */
  async down() {
    this.schema.raw(`
      ALTER TABLE policies
        ADD COLUMN IF NOT EXISTS requires_human_validation boolean NOT NULL DEFAULT true;

      ALTER TABLE vehicle_schedule_states
        DROP CONSTRAINT IF EXISTS ck_vehicle_schedule_states_cause,
        DROP CONSTRAINT IF EXISTS ck_vehicle_schedule_states_outcome;

      ALTER TABLE schedule_enforcement_events DROP CONSTRAINT ck_schedule_events_kind;
      ALTER TABLE schedule_enforcement_events
        ADD CONSTRAINT ck_schedule_events_kind CHECK (kind IN (${EVENT_KINDS}, 'overridden'));

      ALTER TABLE vehicle_schedules
        ADD COLUMN mode text NOT NULL DEFAULT 'allowed',
        ADD CONSTRAINT ck_vehicle_schedules_mode CHECK (mode IN ('allowed','forbidden'));
      ALTER TABLE vehicle_schedule_groups
        ADD COLUMN mode text NOT NULL DEFAULT 'allowed',
        ADD CONSTRAINT ck_vehicle_schedule_groups_mode CHECK (mode IN ('allowed','forbidden'));
    `)
  }
}
