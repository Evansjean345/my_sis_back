import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { errors as authErrors } from '@adonisjs/auth'
import { DomainError } from '#domain/kernel'
import { FlespiApiError } from '#infrastructure/gateways/flespi/flespi_client'
import { FlespiIdentError } from '#infrastructure/gateways/flespi/flespi_ident'
import { ProvisioningError } from '#infrastructure/gateways/flespi/flespi_provisioning'

/**
 * Index uniques des identifiants de compte (migrations 002 et 014). Un e-mail
 * et un téléphone désignent UN SEUL compte actif : c'est ce qui rend fiable
 * la récupération de mot de passe par e-mail ou par SMS.
 */
const UNIQUE_ACCOUNT_IDENTIFIERS: Record<string, { code: string; message: string }> = {
  uq_users_email: {
    code: 'E_EMAIL_TAKEN',
    message: 'Cette adresse e-mail est déjà associée à un compte',
  },
  uq_users_phone: {
    code: 'E_PHONE_TAKEN',
    message: 'Ce numéro de téléphone est déjà associé à un compte',
  },
  // Même traitement pour les autres identifiants métier uniques par organisation
  // (migrations 005 et 018) : la course entre deux requêtes produit le même code
  // que la pré-vérification du contrôleur.
  uq_usage_schedules_org_name: {
    code: 'E_SCHEDULE_NAME_TAKEN',
    message: 'Un calendrier portant ce nom existe déjà dans cette organisation',
  },
  uq_drivers_org_license: {
    code: 'E_DRIVER_LICENSE_TAKEN',
    message: 'Ce numéro de permis est déjà attribué à un conducteur de cette organisation',
  },
  uq_drivers_org_employee_code: {
    code: 'E_DRIVER_EMPLOYEE_CODE_TAKEN',
    message: 'Ce matricule est déjà attribué à un conducteur de cette organisation',
  },
}

/**
 * =========================================================================
 *  FRONTIÈRE ERREURS MÉTIER <-> HTTP
 * =========================================================================
 *
 * Le domaine ne connaît pas HTTP : il retourne des `DomainError` porteuses
 * d'un `code` stable. C'est ici, et uniquement ici, qu'on les traduit en
 * statuts et en corps de réponse.
 *
 * Format unique sur toute l'API :
 *
 *   { "error": { "code": "E_VEHICLE_IN_MOTION",
 *                "message": "...",
 *                "details": { "currentKph": 47, "limitKph": 5 } } }
 *
 * Le `code` est le contrat consommé par le front et les systèmes tiers ;
 * le `message` s'adresse aux humains et ne doit jamais être parsé.
 */
export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    //objet instancié pour traiter les erreurs liées aux identitées du domaine
    if (error instanceof DomainError)
      return ctx.response.status(error.httpStatus).send({ error: error.toJSON() })

    /**
     * Erreur renvoyée par flespi : on relaie le MOTIF flespi (« device not
     * connected », « ident already exists »…), qui est directement actionnable.
     */
    /*objet intancié pour traiter les erreurs liées à Flespi --- 
    un code d'erreur de 0 est mauvaise configuration de flespi
    */
    if (error instanceof FlespiApiError) {
      return ctx.response.status(error.httpStatusForClient).send({
        error: {
          code: error.status === 0 ? 'E_FLESPI_NOT_CONFIGURED' : 'E_FLESPI',
          message: error.reason,
          details: { flespiStatus: error.status, path: error.path, errors: error.errors },
        },
      })
    }

    /*
    Erreur lié aux appels flespi
    */
    if (error instanceof ProvisioningError) {
      return ctx.response.status(error.httpStatus).send({
        error: { code: error.code, message: error.message, details: error.details },
      })
    }

    /*
     Erreurs liées aux identifiants des ressources flespi
     */
    if (error instanceof FlespiIdentError) {
      return ctx.response.status(422).send({
        error: { code: 'E_FLESPI_IDENT', message: error.message, details: { hint: error.hint } },
      })
    }

    /*
    Erreur liées aux invalidations des données transmises
    */
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      return ctx.response.status(422).send({
        error: {
          code: 'E_VALIDATION',
          message: 'Les données transmises sont invalides',
          details: { fields: error.messages },
        },
      })
    }

    /*
    Erreur lié à l'authentification
    */
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.status(401).send({
        error: { code: 'E_UNAUTHORIZED', message: 'Authentification requise', details: {} },
      })
    }

    /**
     * Conflit de sérialisation PostgreSQL (SQLSTATE 40001).
     *
     * Attendu sous isolation SERIALIZABLE : deux transactions concurrentes
     * ont été jugées non sérialisables. Ce n'est pas un bug, c'est le
     * mécanisme qui fonctionne. Le client doit rejouer sa requête.
     */

    /*
    Erreur traitant deux requetes concurrentes
    */
    if (this.isSerializationFailure(error)) {
      ctx.response.header('Retry-After', '1')
      return ctx.response.status(409).send({
        error: {
          code: 'E_CONCURRENT_MODIFICATION',
          message:
            'Une opération concurrente a été détectée sur la même ressource. ' +
            'Merci de relancer la demande.',
          details: {},
        },
      })
    }

    /**
     * Clé étrangère (23503) : la requête référence une ligne qui n'existe pas.
     * Ce n'est pas un conflit d'état (409) mais une donnée invalide (422), et
     * le `detail` de PostgreSQL nomme précisément la colonne et la valeur
     * fautives — beaucoup plus actionnable que « contrainte d'intégrité ».
     */
    if (this.isForeignKeyViolation(error)) {
      const pg = error as { constraint?: string; detail?: string; table?: string }
      return ctx.response.status(422).send({
        error: {
          code: 'E_UNKNOWN_REFERENCE',
          message:
            'La requête référence une ressource inexistante. ' +
            "Vérifier les identifiants transmis (l'URL et le corps ne sont peut-être pas " +
            'dans le bon ordre).',
          details: app.inProduction
            ? {}
            : { constraint: pg.constraint, table: pg.table, detail: pg.detail },
        },
      })
    }

    if (this.isConstraintViolation(error)) {
      const pg = error as { constraint?: string }

      // Identifiants de compte : code stable et message clair, quel que soit
      // le chemin (création, modification, admin, course entre deux requêtes).
      const identifiant = pg.constraint ? UNIQUE_ACCOUNT_IDENTIFIERS[pg.constraint] : undefined
      if (identifiant) {
        return ctx.response.status(409).send({
          error: { code: identifiant.code, message: identifiant.message, details: {} },
        })
      }

      return ctx.response.status(409).send({
        error: {
          code: 'E_CONSTRAINT_VIOLATION',
          message: "L'opération viole une contrainte d'intégrité de la base",
          details: app.inProduction ? {} : { constraint: pg.constraint },
        },
      })
    }

    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    // Une règle métier violée n'est pas un incident : la journaliser en
    // erreur rendrait les vraies pannes invisibles.
    if (error instanceof DomainError) return
    if (error instanceof vineErrors.E_VALIDATION_ERROR) return
    return super.report(error, ctx)
  }

  /* Erreur de formatage des données */
  private isSerializationFailure(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '40001'
    )
  }

  /*
    Erreur de violation de clé etrangère SQL 
    */
  private isForeignKeyViolation(error: unknown): boolean {
    return this.sqlState(error) === '23503'
  }

  /*
  Erreur de violation de contrainte d'unicité
  */
  private isConstraintViolation(error: unknown): boolean {
    // 23505 unique · 23514 check · 23P01 exclusion (23503 traité à part)
    return ['23505', '23514', '23P01'].includes(this.sqlState(error) ?? '')
  }

  /*
  Erreur de standaristion des données
  */
  private sqlState(error: unknown): string | null {
    if (typeof error !== 'object' || error === null || !('code' in error)) return null
    return (error as { code: string }).code
  }
}
