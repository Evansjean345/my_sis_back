import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  JOURNAL D'EXÉCUTION DE L'IMMOBILISATION PLANIFIÉE
 * =========================================================================
 *
 * `vehicle_schedule_states` ne garde que le DERNIER état de chaque véhicule :
 * impossible d'y lire « combien de coupures ont été refusées ce mois-ci, et
 * pourquoi ? ». `device_commands` répond pour les commandes émises, mais un
 * refus AVANT émission (véhicule en mouvement — CM-07 —, pas de position,
 * commande déjà en vol) n'y laisse aucune trace.
 *
 * Cette table journalise chaque événement significatif du moteur, rattaché
 * au calendrier décisif — c'est la source des analyses par jour, par heure,
 * par calendrier et par véhicule :
 *
 *   transition           entrée / sortie de plage (`desired_state`)
 *   dispatched           commande émise (`command_id` → son issue dans device_commands)
 *   refused              tentative refusée (`error_code`), une ligne par tentative
 *   completed            objectif atteint ; `pending_since` donne le délai réel
 *                        entre l'entrée en plage et la confirmation du boîtier
 *   overridden           un opérateur a repris la main
 *   manual_cut_kept      fin de plage, coupure manuelle conservée (jamais levée)
 *   already_immobilized  début de plage, moteur déjà coupé
 *
 * Écrite par le seul moteur (acteur système), jamais modifiée ensuite.
 * Volume : quelques lignes par véhicule et par jour ; index sur
 * (organization_id, occurred_at) pour les analyses bornées dans le temps.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE schedule_enforcement_events (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        vehicle_id         uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
        usage_schedule_id  uuid REFERENCES usage_schedules (id) ON DELETE SET NULL,
        vehicle_group_id   uuid REFERENCES vehicle_groups (id) ON DELETE SET NULL,
        kind               text NOT NULL,
        desired_state      text,
        action             text,
        command_id         uuid REFERENCES device_commands (id) ON DELETE SET NULL,
        error_code         text,
        pending_since      timestamptz,
        occurred_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_schedule_events_kind CHECK (kind IN (
          'transition','dispatched','refused','completed',
          'overridden','manual_cut_kept','already_immobilized'
        )),
        CONSTRAINT ck_schedule_events_desired CHECK (desired_state IS NULL OR desired_state IN ('free','immobilized')),
        CONSTRAINT ck_schedule_events_action CHECK (action IS NULL OR action IN ('cut','restore')),
        CONSTRAINT ck_schedule_events_refused CHECK (kind <> 'refused' OR error_code IS NOT NULL),
        CONSTRAINT ck_schedule_events_dispatched CHECK (kind <> 'dispatched' OR command_id IS NOT NULL)
      );

      CREATE INDEX idx_schedule_events_org_time ON schedule_enforcement_events (organization_id, occurred_at);
      CREATE INDEX idx_schedule_events_vehicle_time ON schedule_enforcement_events (vehicle_id, occurred_at);
      CREATE INDEX idx_schedule_events_schedule ON schedule_enforcement_events (usage_schedule_id, occurred_at)
        WHERE usage_schedule_id IS NOT NULL;
      CREATE INDEX idx_schedule_events_command ON schedule_enforcement_events (command_id)
        WHERE command_id IS NOT NULL;

      -- Analyses de l'historique réel : commandes du moteur bornées dans le temps.
      CREATE INDEX IF NOT EXISTS idx_device_commands_schedule_time
        ON device_commands (organization_id, requested_at)
        WHERE origin = 'schedule';
    `)
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS idx_device_commands_schedule_time')
    this.schema.raw('DROP TABLE IF EXISTS schedule_enforcement_events')
  }
}
