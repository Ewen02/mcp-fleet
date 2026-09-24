/**
 * Identité d'un serveur, lue dans SON package.json.
 *
 * Une seule source de vérité pour la version : package.json, lu à l'exécution
 * (et validé) plutôt qu'importé, parce qu'il est hors de rootDir pour le build.
 * Le serveur passe l'URL de son propre fichier : le kit ne devine rien.
 */
import { readFileSync } from 'node:fs'
import * as z from 'zod/v4'
import type { ServerInfo } from './definition.js'

const packageSchema = z.object({ name: z.string().min(1), version: z.string().min(1) })

export function readServerInfo(packageJsonUrl: URL): ServerInfo {
  const pkg = packageSchema.parse(JSON.parse(readFileSync(packageJsonUrl, 'utf8')))
  return { name: pkg.name, version: pkg.version }
}
