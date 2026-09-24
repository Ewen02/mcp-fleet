#!/usr/bin/env node
/**
 * Point d'entrée distant (Streamable HTTP, derrière Caddy).
 * Configuration par variables d'environnement : voir DEPLOY.md.
 * Garde-fous, logs, limite de débit et arrêt propre viennent du kit.
 */
import { runHttp } from '@repo/mcp-kit'
import { definition } from './server.js'

runHttp(definition)
