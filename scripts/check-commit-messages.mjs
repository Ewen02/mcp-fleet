#!/usr/bin/env node
/**
 * Vérifie la règle de commit d'AGENTS.md § Commits :
 * - aucune attribution à une IA (trailer Co-Authored-By, ligne « Generated
 *   with », adresse noreply d'Anthropic, 🤖, nom d'outil) ;
 * - un titre de 72 caractères au plus.
 * Sur les messages de commit d'une plage, et sur le titre et la description
 * d'une pull request (variables PR_TITLE et PR_BODY).
 *
 *   node scripts/check-commit-messages.mjs <base> <head>   commits de base..head
 *   node scripts/check-commit-messages.mjs --all <head>    tout l'historique jusqu'à head
 *
 * On cible les formes d'attribution, pas le mot « Claude » seul : un commit
 * peut légitimement parler de « Claude Desktop » (un client MCP).
 */
import { execFileSync } from 'node:child_process'

const AI = '(claude|anthropic|copilot|openai|chatgpt|gpt|gemini|codex|cursor)'
const ATTRIBUTION = [
  new RegExp(String.raw`^co-authored-by:.*\b${AI}\b`, 'im'),
  new RegExp(String.raw`generated (with|by)\b.*\b${AI}\b`, 'i'),
  /noreply@anthropic\.com/i,
  /\bclaude code\b/i,
  /🤖/u,
]
const MAX_SUBJECT = 72

const [first, second] = process.argv.slice(2)
if (!first || !second) {
  console.error('usage: check-commit-messages.mjs <base> <head> | --all <head>')
  process.exit(2)
}
const range = first === '--all' ? [second] : [`${first}..${second}`]

// Un enregistrement par commit : SHA court, NUL, message complet, séparateur RS.
const log = execFileSync('git', ['log', '--format=%h%x00%B%x1e', ...range], { encoding: 'utf8' })
const commits = log
  .split('\x1e')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [sha = '', message = ''] = entry.split('\x00')
    return { sha, message: message.trim() }
  })

const problems = []
for (const { sha, message } of commits) {
  const subject = message.split('\n')[0] ?? ''
  if (subject.length > MAX_SUBJECT)
    problems.push(`${sha}: subject is ${subject.length} characters (max ${MAX_SUBJECT})`)
  if (ATTRIBUTION.some((re) => re.test(message))) problems.push(`${sha}: mentions an AI assistant ("${subject}")`)
}
// Lancé par la CI, pas par Turborepo : rien à déclarer dans turbo.json.
const { PR_TITLE, PR_BODY } = process.env
for (const [field, text] of [
  ['pull request title', PR_TITLE],
  ['pull request description', PR_BODY],
]) {
  if (text && ATTRIBUTION.some((re) => re.test(text))) problems.push(`${field}: mentions an AI assistant`)
}

if (problems.length > 0) {
  console.error(`Commit rules (AGENTS.md § Commits) not met:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`${commits.length} commit(s) checked: OK`)
