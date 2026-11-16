import { ListLoader } from '@adonisjs/core/ace'
import SplitSchemaGenerate from './split_schema_generate.js'

/**
 * Chargeur de commandes déclaré dans `adonisrc.ts`, APRÈS celui de Lucid :
 * à nom égal, le dernier chargeur enregistré l'emporte. `schema:generate`
 * — appelée directement ou par `migration:run` / `migration:rollback` —
 * désigne donc la version « un fichier par table ».
 *
 * Volontairement hors du dossier `commands/` : AdonisJS ne lit ce dossier
 * qu'APRÈS avoir cherché la commande dans les paquets, la surcharge n'y
 * serait jamais prise en compte.
 */
const loader = new ListLoader([SplitSchemaGenerate])

export const getMetaData = () => loader.getMetaData()
export const getCommand: typeof loader.getCommand = (metaData) => loader.getCommand(metaData)
