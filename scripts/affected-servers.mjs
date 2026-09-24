#!/usr/bin/env node
/**
 * Liste les serveurs MCP à reconstruire et redéployer, au format matrice
 * GitHub Actions : [{"dir":"paie-fr","name":"mcp-paie-fr"}].
 *
 *   node scripts/affected-servers.mjs             tous les serveurs
 *   node scripts/affected-servers.mjs --affected  ceux que Turborepo juge touchés
 *                                                 depuis TURBO_SCM_BASE
 *   node scripts/affected-servers.mjs paie-fr     ceux nommés (dossiers de servers/)
 *
 * Avec --affected, c'est le graphe de dépendances de Turborepo qui décide :
 * un fichier d'un serveur → ce serveur ; le kit → tous les serveurs qui en
 * dépendent ; Dockerfile, .dockerignore, pnpm-workspace.yaml… (globalDependencies
 * de turbo.json) → tous ; la doc à la racine → aucun.
 *
 * `dir` = dossier de servers/ (build arg SERVER du Dockerfile),
 * `name` = nom du paquet = nom du projet sur le VPS (conteneur, réseau, image).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)

const allServers = readdirSync('servers', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(`servers/${entry.name}/package.json`))
  .map((entry) => entry.name)

let dirs
if (args[0] === '--affected') {
  // `turbo ls --output json` est marqué expérimental : la version de turbo est
  // figée par le lockfile, et un changement de format fait échouer ce script
  // (donc la CI) au lieu de passer un serveur sous silence.
  // Binaire appelé directement, pas via `pnpm exec` : pnpm peut écrire sur
  // stdout (installation préalable) et corrompre le JSON.
  const out = execFileSync('node_modules/.bin/turbo', ['ls', '--affected', '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  dirs = JSON.parse(out)
    .packages.items.map((pkg) => pkg.path)
    .filter((path) => path.startsWith('servers/'))
    .map((path) => path.slice('servers/'.length))
} else if (args.length > 0 && args.join(' ') !== 'all') {
  dirs = args.flatMap((arg) => arg.split(/[\s,]+/)).filter(Boolean)
  const unknown = dirs.filter((dir) => !allServers.includes(dir))
  if (unknown.length > 0) throw new Error(`Unknown server(s): ${unknown.join(', ')}. Known: ${allServers.join(', ')}`)
} else {
  dirs = allServers
}

const matrix = [...new Set(dirs)].sort().map((dir) => {
  const { name } = JSON.parse(readFileSync(`servers/${dir}/package.json`, 'utf8'))
  // Même contrainte que ~/infra/scripts/deploy.sh sur le nom de projet.
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(name)) throw new Error(`Invalid project name "${name}" in servers/${dir}`)
  return { dir, name }
})

console.log(JSON.stringify(matrix))
// biome-ignore lint/suspicious/noUndeclaredEnvVars: lancé par la CI, pas une tâche Turborepo (rien à mettre en cache)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `servers=${JSON.stringify(matrix)}\n`)
