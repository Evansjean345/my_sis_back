/*
|--------------------------------------------------------------------------
| Variables d'environnement
|--------------------------------------------------------------------------
|
| Toutes les variables sont validées AU DÉMARRAGE, dans un schéma UNIQUE.
| L'application refuse de démarrer si une variable de sécurité manque ou est
| mal typée, plutôt que d'échouer en production au pire moment.
|
| Le schéma unique n'est pas cosmétique : c'est lui qui donne son type de
| retour à `env.get()`. Avec deux `Env.create` séparés, `env.get('DB_PORT')`
| retombe sur `string`, que la configuration Lucid refuse.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // ---------------------------------------------------------- application
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

  // ---------------------------------------------------------- base de données
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string(),
  DB_DATABASE: Env.schema.string(),
  DB_SSL: Env.schema.boolean.optional(),
  DB_POOL_MIN: Env.schema.number.optional(),
  DB_POOL_MAX: Env.schema.number.optional(),
  DB_READ_HOST: Env.schema.string.optional({ format: 'host' }),
  DB_READ_USER: Env.schema.string.optional(),
  DB_READ_PASSWORD: Env.schema.string.optional(),

  // ---------------------------------------------------------- redis
  REDIS_HOST: Env.schema.string({ format: 'host' }),
  REDIS_PORT: Env.schema.number(),
  REDIS_PASSWORD: Env.schema.string.optional(),

  // ---------------------------------------------------------- immobilisation
  // Paramètres de sécurité : typés strictement, jamais devinés.
  IMMOBILIZATION_ENABLED: Env.schema.boolean.optional(),
  IMMOBILIZATION_SAFETY_SPEED_KPH: Env.schema.number.optional(),
  IMMOBILIZATION_COMMAND_TTL_MINUTES: Env.schema.number.optional(),
  IMMOBILIZATION_MAX_POSITION_AGE_SECONDS: Env.schema.number.optional(),

  // ---------------------------------------------------------- immobilisation planifiée
  SCHEDULE_ENFORCEMENT_ENABLED: Env.schema.boolean.optional(),
  SCHEDULE_ENFORCE_INTERVAL_SECONDS: Env.schema.number.optional(),
  SCHEDULE_ENFORCE_RETRY_SECONDS: Env.schema.number.optional(),
  SCHEDULE_ENFORCE_BACKOFF_SECONDS: Env.schema.number.optional(),

  // ---------------------------------------------------------- ingestion
  INGEST_MAX_HDOP: Env.schema.number.optional(),
  INGEST_MIN_SATELLITES: Env.schema.number.optional(),
  INGEST_MAX_PLAUSIBLE_SPEED_KPH: Env.schema.number.optional(),
  INGEST_BACKLOG_THRESHOLD_SECONDS: Env.schema.number.optional(),
  /** Ingestion : trames traitées simultanément (défaut 4). */
  INGEST_CONCURRENCY: Env.schema.number.optional(),
  INGEST_QUEUE_MAX: Env.schema.number.optional(),
  INGEST_QUEUE_MAX_PER_DEVICE: Env.schema.number.optional(),

  // ---------------------------------------------------------- trajets
  TRIP_IDLE_TIMEOUT_SECONDS: Env.schema.number.optional(),
  TRIP_MAX_DURATION_HOURS: Env.schema.number.optional(),
  TRIP_MIN_DISTANCE_M: Env.schema.number.optional(),

  // ---------------------------------------------------------- flespi
  FLESPI_TOKEN: Env.schema.string.optional(),
  FLESPI_BASE_URL: Env.schema.string.optional(),
  FLESPI_TIMEOUT_MS: Env.schema.number.optional(),
  FLESPI_CHANNEL_ID: Env.schema.number.optional(),
  FLESPI_PROTOCOL_NAME: Env.schema.string.optional(),
  FLESPI_DEVICE_TYPE: Env.schema.string.optional(),
  /** @deprecated remplacé par FLESPI_DEVICE_TYPE (accepte id, name ou title). */
  FLESPI_DEVICE_TYPE_ID: Env.schema.string.optional(),
  FLESPI_DEVICE_MESSAGES_TTL: Env.schema.number.optional(),
  FLESPI_COMMAND_TTL_SECONDS: Env.schema.number.optional(),
  FLESPI_COMMAND_MAX_ATTEMPTS: Env.schema.number.optional(),
  FLESPI_MQTT_HOST: Env.schema.string.optional(),
  FLESPI_MQTT_PORT: Env.schema.number.optional(),
  FLESPI_MQTT_TLS: Env.schema.boolean.optional(),
  FLESPI_MQTT_TOKEN: Env.schema.string.optional(),
  FLESPI_MQTT_CLIENT_ID: Env.schema.string.optional(),
  FLESPI_MQTT_TOPICS: Env.schema.string.optional(),
  FLESPI_MQTT_SHARE_GROUP: Env.schema.string.optional(),
  FLESPI_MQTT_SESSION_EXPIRY: Env.schema.number.optional(),
  FLESPI_WEBHOOK_SECRET: Env.schema.string.optional(),

  // ---------------------------------------------------------- broker mqtt
  MQTT_HOST: Env.schema.string.optional({ format: 'host' }),
  MQTT_PORT: Env.schema.number.optional(),
  MQTT_TLS: Env.schema.boolean.optional(),
  MQTT_CLIENT_ID: Env.schema.string.optional(),
  MQTT_USERNAME: Env.schema.string.optional(),
  MQTT_PASSWORD: Env.schema.string.optional(),
  MQTT_TOPIC_TELEMETRY: Env.schema.string.optional(),
  MQTT_MESSAGE_EXPIRY_SECONDS: Env.schema.number.optional(),
  MQTT_RECONNECT_PERIOD_MS: Env.schema.number.optional(),
  MQTT_CONNECT_TIMEOUT_MS: Env.schema.number.optional(),
  MQTT_MAX_INFLIGHT: Env.schema.number.optional(),

  // ---------------------------------------------------------- notifications
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.number.optional(),
  SMTP_USER: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
  SMTP_FROM: Env.schema.string.optional(),

  // ---------------------------------------------------------- sms (twilio)
  SMS_PROVIDER: Env.schema.enum.optional(['twilio', 'log'] as const),
  SMS_BRAND: Env.schema.string.optional(),
  SMS_ENFORCE_BALANCE: Env.schema.boolean.optional(),
  SMS_DEFAULT_DIAL_CODE: Env.schema.string.optional(),
  TWILIO_ACCOUNT_SID: Env.schema.string.optional(),
  TWILIO_API_KEY_SID: Env.schema.string.optional(),
  TWILIO_API_KEY_SECRET: Env.schema.string.optional(),
  TWILIO_AUTH_TOKEN: Env.schema.string.optional(),
  TWILIO_BASE_URL: Env.schema.string.optional(),
  TWILIO_TIMEOUT_MS: Env.schema.number.optional(),
  TWILIO_FROM: Env.schema.string.optional(),
  TWILIO_MESSAGING_SERVICE_SID: Env.schema.string.optional(),
  TWILIO_STATUS_CALLBACK_URL: Env.schema.string.optional(),

  // ---------------------------------------------------------- e-mail (brevo)
  MAIL_PROVIDER: Env.schema.enum.optional(['brevo', 'log'] as const),
  MAIL_FROM_EMAIL: Env.schema.string.optional(),
  MAIL_FROM_NAME: Env.schema.string.optional(),
  MAIL_REPLY_TO: Env.schema.string.optional(),
  BREVO_API_KEY: Env.schema.string.optional(),
  BREVO_BASE_URL: Env.schema.string.optional(),
  BREVO_TIMEOUT_MS: Env.schema.number.optional(),

  // ---------------------------------------------------------- otp
  OTP_LENGTH: Env.schema.number.optional(),
  OTP_TTL_SECONDS: Env.schema.number.optional(),
  OTP_MAX_ATTEMPTS: Env.schema.number.optional(),
  OTP_RESEND_COOLDOWN_SECONDS: Env.schema.number.optional(),
  OTP_MAX_PER_HOUR: Env.schema.number.optional(),

  // ---------------------------------------------------------- outbox
  OUTBOX_POLL_INTERVAL_MS: Env.schema.number.optional(),
  OUTBOX_BATCH_SIZE: Env.schema.number.optional(),
  OUTBOX_MAX_ATTEMPTS: Env.schema.number.optional(),
  OUTBOX_RETRY_BASE_SECONDS: Env.schema.number.optional(),
  OUTBOX_STALE_LOCK_SECONDS: Env.schema.number.optional(),

  // ---------------------------------------------------------- rétention
  RETENTION_POSITIONS_MONTHS: Env.schema.number.optional(),
  RETENTION_INGEST_MESSAGES_MONTHS: Env.schema.number.optional(),
  RETENTION_REPORTS_DAYS: Env.schema.number.optional(),
})
