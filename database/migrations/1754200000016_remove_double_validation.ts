import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  Fin de la double validation des immobilisations (révision du TDR)
 * =========================================================================
 *
 * Une coupure moteur n'est plus validée par un second opérateur : la demande
 * est acceptée ou refusée par le garde-fou de vitesse (CM-07), puis émise.
 * Le contrôle de vitesse est refait juste avant l'émission.
 *
 * ① device_commands
 *   - colonnes retirées : requires_validation, validated_by, validated_at,
 *     rejection_reason ;
 *   - statuts retirés : pending_validation, rejected ; une commande naît
 *     `approved` (demande acceptée, pas encore émise) ;
 *   - contraintes retirées : ck_device_commands_four_eyes, _validated, _rejected ;
 *   - contraintes et index réécrits sans les statuts retirés.
 *   Reprise de l'existant :
 *     pending_validation → cancelled  (ne pourra plus jamais être validée,
 *                                      et libère le boîtier, CM-09)
 *     rejected           → cancelled, motif du refus et auteur conservés
 *                                      dans error_message
 *   Chaque reprise est tracée dans device_command_logs (acteur `system`).
 *
 * ② RBAC — matrice figée des trois rôles système
 *   command:validate disparaît. command:request est scindée en deux :
 *     command:immobilize  couper / rétablir un moteur
 *     command:sensitive   commandes boîtier sensibles (APN, mot de passe,
 *                         numéro admin, sortie) et commande flespi brute
 *
 *     super_admin  *
 *     admin        … command:* (couvre les deux)
 *     operator     lecture + command:immobilize
 *
 *   `billing:*` est retiré de l'admin : le solde SMS est global depuis la
 *   migration 015, il relève de la plateforme (super_admin).
 *
 *   Les rôles propres à une organisation qui détenaient command:request
 *   reçoivent les deux nouvelles habilitations : aucun droit n'est perdu.
 */
const ADMIN_PERMISSIONS = [
  'vehicle:*',
  'device:*',
  'user:*',
  'geofence:*',
  'policy:*',
  'alert:*',
  'incident:*',
  'report:*',
  'command:*',
  'audit:read',
]

const OPERATOR_PERMISSIONS = [
  'vehicle:read',
  'device:read',
  'geofence:read',
  'alert:read',
  'incident:read',
  'report:read',
  'command:immobilize',
]

const sqlArray = (values: string[]) => `ARRAY[${values.map((v) => `'${v}'`).join(', ')}]::text[]`

export default class extends BaseSchema {
  async up() {
    // ------------------------------------------------------------- ① reprise des commandes
    this.schema.raw(`
      INSERT INTO device_command_logs (command_id, status_from, status_to, actor_type, note, payload)
      SELECT id, status, 'cancelled', 'system',
             CASE status
               WHEN 'pending_validation' THEN 'Double validation supprimée : demande en attente annulée'
               ELSE 'Double validation supprimée : statut rejected repris en cancelled'
             END,
             jsonb_build_object(
               'migration', '1754200000016_remove_double_validation',
               'validatedBy', validated_by,
               'validatedAt', validated_at,
               'rejectionReason', rejection_reason
             )
        FROM device_commands
       WHERE status IN ('pending_validation', 'rejected');

      UPDATE device_commands
         SET error_message = coalesce(error_message || ' · ', '')
                             || 'Refusée à la validation : ' || coalesce(rejection_reason, 'motif non renseigné')
        WHERE status = 'rejected';

      UPDATE device_commands
         SET status = 'cancelled'
       WHERE status IN ('pending_validation', 'rejected');
    `)

    // ------------------------------------------------------------- ① structure
    this.schema.raw(`
      ALTER TABLE device_commands
        DROP CONSTRAINT ck_device_commands_four_eyes,
        DROP CONSTRAINT ck_device_commands_validated,
        DROP CONSTRAINT ck_device_commands_rejected,
        DROP CONSTRAINT ck_device_commands_status,
        DROP CONSTRAINT ck_device_commands_speed_guard;

      ALTER TABLE device_commands
        DROP COLUMN requires_validation,
        DROP COLUMN validated_by,
        DROP COLUMN validated_at,
        DROP COLUMN rejection_reason,
        ALTER COLUMN status SET DEFAULT 'approved';

      ALTER TABLE device_commands
        ADD CONSTRAINT ck_device_commands_status CHECK (status IN (
          'approved','queued','sent','acknowledged','failed','cancelled','expired'
        )),
        -- CM-07 : jamais de coupure au-dessus du seuil de sécurité
        ADD CONSTRAINT ck_device_commands_speed_guard CHECK (
          command_type <> 'engine_cut'
          OR status IN ('cancelled','expired')
          OR (speed_at_request_kph IS NOT NULL AND speed_at_request_kph <= safety_speed_limit_kph)
        );

      -- CM-09 : une seule commande en vol par tracker
      DROP INDEX uq_device_commands_in_flight;
      CREATE UNIQUE INDEX uq_device_commands_in_flight ON device_commands (device_id)
        WHERE status IN ('approved','queued','sent');

      DROP INDEX idx_device_commands_expiring;
      CREATE INDEX idx_device_commands_expiring ON device_commands (expires_at)
        WHERE status IN ('approved','queued');
    `)

    // ------------------------------------------------------------- ② RBAC
    this.schema.raw(`
      -- rôles propres aux organisations : command:request → immobilize + sensitive
      UPDATE roles
         SET permissions = (
               SELECT array_agg(DISTINCT p ORDER BY p)
                 FROM unnest(
                        array_remove(array_remove(permissions, 'command:request'), 'command:validate')
                        || CASE WHEN 'command:request' = ANY (permissions)
                                THEN ARRAY['command:immobilize', 'command:sensitive']
                                ELSE ARRAY[]::text[] END
                      ) AS p
             )
       WHERE organization_id IS NOT NULL
         AND permissions && ARRAY['command:request', 'command:validate'];

      -- rôles système : matrice figée
      UPDATE roles SET permissions = ARRAY['*']::text[]
       WHERE organization_id IS NULL AND code = 'super_admin';
      UPDATE roles SET permissions = ${sqlArray(ADMIN_PERMISSIONS)},
             description = 'Gestion complète du périmètre de son organisation'
       WHERE organization_id IS NULL AND code = 'admin';
      UPDATE roles SET permissions = ${sqlArray(OPERATOR_PERMISSIONS)},
             description = 'Suivi temps réel, consultation, coupure et rétablissement moteur'
       WHERE organization_id IS NULL AND code = 'operator';
    `)
  }

  /**
   * Restaure la STRUCTURE (colonnes, statuts, contraintes, habilitations).
   * Les commandes reprises restent `cancelled` : leur statut d'origine est
   * dans device_command_logs.
   */
  async down() {
    this.schema.raw(`
      ALTER TABLE device_commands
        DROP CONSTRAINT ck_device_commands_status,
        DROP CONSTRAINT ck_device_commands_speed_guard;

      ALTER TABLE device_commands
        ADD COLUMN requires_validation boolean NOT NULL DEFAULT false,
        ADD COLUMN validated_by        uuid REFERENCES users (id) ON DELETE SET NULL,
        ADD COLUMN validated_at        timestamptz,
        ADD COLUMN rejection_reason    text,
        ALTER COLUMN status SET DEFAULT 'pending_validation';

      ALTER TABLE device_commands
        ADD CONSTRAINT ck_device_commands_status CHECK (status IN (
          'pending_validation','approved','rejected','queued','sent',
          'acknowledged','failed','cancelled','expired'
        )),
        ADD CONSTRAINT ck_device_commands_speed_guard CHECK (
          command_type <> 'engine_cut'
          OR status IN ('pending_validation','rejected','cancelled','expired')
          OR (speed_at_request_kph IS NOT NULL AND speed_at_request_kph <= safety_speed_limit_kph)
        ),
        ADD CONSTRAINT ck_device_commands_four_eyes CHECK (
          NOT requires_validation OR validated_by IS NULL
          OR requested_by IS NULL OR validated_by <> requested_by
        ),
        ADD CONSTRAINT ck_device_commands_validated CHECK (
          status NOT IN ('approved','queued','sent','acknowledged')
          OR NOT requires_validation OR validated_at IS NOT NULL
        ),
        ADD CONSTRAINT ck_device_commands_rejected CHECK (
          status <> 'rejected' OR rejection_reason IS NOT NULL
        );

      DROP INDEX uq_device_commands_in_flight;
      CREATE UNIQUE INDEX uq_device_commands_in_flight ON device_commands (device_id)
        WHERE status IN ('pending_validation','approved','queued','sent');
      DROP INDEX idx_device_commands_expiring;
      CREATE INDEX idx_device_commands_expiring ON device_commands (expires_at)
        WHERE status IN ('pending_validation','approved','queued');
    `)

    this.schema.raw(`
      UPDATE roles
         SET permissions = (
               SELECT array_agg(DISTINCT p ORDER BY p)
                 FROM unnest(
                        array_remove(array_remove(permissions, 'command:immobilize'), 'command:sensitive')
                        || ARRAY['command:request']
                      ) AS p
             )
       WHERE organization_id IS NOT NULL
         AND permissions && ARRAY['command:immobilize', 'command:sensitive'];

      UPDATE roles SET permissions = array_remove(permissions, 'command:immobilize')
       WHERE organization_id IS NULL AND code = 'operator';
    `)
  }
}
