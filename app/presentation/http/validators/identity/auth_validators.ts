import vine from '@vinejs/vine'

/* ajouter numéro de téléphone */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email().normalizeEmail(),
    password: vine.string().minLength(8).maxLength(128),
  })
)
