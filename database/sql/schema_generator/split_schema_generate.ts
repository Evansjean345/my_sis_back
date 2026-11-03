import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import stringHelpers from '@adonisjs/core/helpers/string'
import SchemaGenerate from '@adonisjs/lucid/commands/schema_generate'

/**
 * =========================================================================
 *  node ace schema:generate — UN FICHIER PAR TABLE
 * =========================================================================
 *
 * Remplace la commande Lucid du même nom (le chargeur des commandes de
 * l'application passe après celui de Lucid : le dernier enregistré gagne).
 * `migration:run` et `migration:rollback` l'appellent d'eux-mêmes : rien ne
 * change dans le flux de travail.
 *
 *   AVANT  database/schema.ts              59 classes dans un seul fichier
 *   APRÈS  database/schema/users.ts        UserSchema
 *          database/schema/vehicles.ts     VehicleSchema
 *          …
 *          database/schema/index.ts        réexporte toutes les classes
 *
 * Le générateur Lucid produit le code (aucune logique de typage recopiée
 * ici) dans un fichier temporaire, découpé ensuite classe par classe.
 *
 * Ne sont PAS générées :
 *   - les partitions mensuelles (`positions_202611`, `audit_logs_202607`…) :
 *     elles ont les colonnes de leur table mère et changent chaque mois ;
 *   - `spatial_ref_sys`, table interne de PostGIS.
 */

const OUTPUT_DIR = 'database/schema'
const MARKER = 'Fichier généré par `node ace schema:generate`'
const HEADER = [
  '/**',
  ` * ${MARKER} — NE PAS MODIFIER À LA MAIN.`,
  ' * Régénéré à chaque `node ace migration:run` / `migration:rollback`.',
  ' */',
].join('\n')

/** Tables exclues en plus de celles de la configuration Lucid. */
const ALWAYS_EXCLUDED = ['spatial_ref_sys']

interface ParsedImport {
  source: string
  names: string[]
  typeOnly: boolean
}

export default class SplitSchemaGenerate extends SchemaGenerate {
  static description = 'Génère database/schema/<table>.ts : une classe de schéma par table'

  async run() {
    const db = await this.app.container.make('lucid.db')
    const connectionName = this.connection || db.primaryConnectionName
    const managerConnection = db.manager.get(connectionName)

    // Connexion invalide ou génération désactivée : la commande Lucid répond.
    if (!managerConnection || managerConnection.config.schemaGeneration?.enabled === false) {
      return super.run()
    }

    const config = managerConnection.config
    const original = config.schemaGeneration
    const tmpFile = this.app.makePath('tmp', `schema.${process.pid}.generated.ts`)
    const excluded = [...ALWAYS_EXCLUDED, ...(await this.partitionChildren(db, connectionName))]

    config.schemaGeneration = {
      ...original,
      outputPath: tmpFile,
      excludeTables: [...(original?.excludeTables ?? []), ...excluded],
    }
    try {
      await super.run()
    } finally {
      config.schemaGeneration = original
    }
    if (this.exitCode) return

    try {
      const tables = await this.tableNames(db, connectionName, [
        ...excluded,
        ...(original?.excludeTables ?? []),
      ])
      const written = await this.split(await readFile(tmpFile, 'utf-8'), tables)
      this.logger.success(`${written} fichiers de schéma écrits dans ${OUTPUT_DIR}/`)
    } catch (error) {
      this.logger.error('Découpage du schéma impossible')
      this.error = error
      this.exitCode = 1
    } finally {
      await rm(tmpFile, { force: true })
    }
  }

  // -------------------------------------------------------------------------

  private async partitionChildren(db: any, connectionName: string): Promise<string[]> {
    const r = await db.connection(connectionName).rawQuery(
      `SELECT c.relname AS name
         FROM pg_inherits i
         JOIN pg_class c     ON c.oid = i.inhrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'`
    )
    return r.rows.map((row: { name: string }) => row.name)
  }

  /** Tables effectivement générées, dans l'ordre alphabétique. */
  private async tableNames(db: any, connectionName: string, excluded: string[]) {
    const migrations =
      db.manager.get(connectionName)?.config.migrations?.tableName ?? 'adonis_schema'
    const skip = new Set([...excluded, migrations, `${migrations}_versions`])
    const r = await db.connection(connectionName).rawQuery(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY 1`
    )
    return (r.rows as Array<{ name: string }>).map((row) => row.name).filter((n) => !skip.has(n))
  }

  /** Nom de classe produit par Lucid pour une table (même règle que son générateur). */
  private className(table: string): string {
    return `${stringHelpers.pascalCase(stringHelpers.singular(table))}Schema`
  }

  private parseImports(block: string): ParsedImport[] {
    const imports: ParsedImport[] = []
    const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g
    for (const m of block.matchAll(re)) {
      imports.push({
        typeOnly: Boolean(m[1]),
        names: m[2]
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
        source: m[3],
      })
    }
    return imports
  }

  private importsFor(body: string, imports: ParsedImport[]): string {
    const lines: string[] = []
    for (const imp of imports) {
      const used = imp.names.filter((n) => {
        const local = n
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)
          .pop()!
        return new RegExp(`\\b${local}\\b`).test(body)
      })
      if (used.length) {
        lines.push(
          `import ${imp.typeOnly ? 'type ' : ''}{ ${used.join(', ')} } from '${imp.source}'`
        )
      }
    }
    return lines.join('\n')
  }

  private async split(generated: string, tables: string[]): Promise<number> {
    // Base vide (rollback complet) : aucune classe, le dossier est simplement vidé.
    const firstClass = generated.indexOf('export class ')
    if (firstClass < 0 && tables.length > 0) {
      throw new Error('Aucune classe dans la sortie du générateur Lucid')
    }
    const imports = firstClass < 0 ? [] : this.parseImports(generated.slice(0, firstClass))

    const classes = new Map<string, string>()
    const corps = firstClass < 0 ? '' : generated.slice(firstClass)
    for (const chunk of corps.split(/\n(?=export class )/)) {
      const name = /^export class (\w+)/.exec(chunk)?.[1]
      if (name) classes.set(name, chunk.trim())
    }

    const outputDir = this.app.makePath(OUTPUT_DIR)
    await mkdir(outputDir, { recursive: true })

    const files = new Map<string, string>()
    const index: string[] = []
    for (const table of tables) {
      const name = this.className(table)
      const body = classes.get(name)
      if (!body) throw new Error(`Classe ${name} absente de la sortie Lucid (table ${table})`)
      classes.delete(name)
      files.set(`${table}.ts`, `${HEADER}\n\n${this.importsFor(body, imports)}\n\n${body}\n`)
      index.push(`export { ${name} } from './${table}.js'`)
    }
    if (classes.size) {
      throw new Error(`Classes sans table correspondante : ${[...classes.keys()].join(', ')}`)
    }
    files.set('index.ts', `${HEADER}\n\n${index.join('\n')}\n`)

    // Retire les fichiers générés d'une table qui n'existe plus.
    for (const existing of await readdir(outputDir)) {
      if (files.has(existing) || !existing.endsWith('.ts')) continue
      const content = await readFile(join(outputDir, existing), 'utf-8')
      if (content.includes(MARKER)) await rm(join(outputDir, existing))
    }

    const format = await this.formatter()
    for (const [file, content] of files) {
      const path = join(outputDir, file)
      await writeFile(path, await format(content, path), 'utf-8')
    }
    return files.size
  }

  /** Prettier s'il est installé (développement), sinon le texte tel quel. */
  private async formatter(): Promise<(code: string, path: string) => Promise<string>> {
    try {
      const prettier = await import('prettier')
      const options =
        (await prettier.resolveConfig(this.app.makePath(OUTPUT_DIR, 'index.ts'))) ?? {}
      return (code, path) => prettier.format(code, { ...options, filepath: path })
    } catch {
      return async (code) => code
    }
  }
}
