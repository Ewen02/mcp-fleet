#!/usr/bin/env node
/**
 * Point d'entrée local (Claude Desktop, Cursor, Inspector…).
 * Le transport, les logs et l'arrêt propre viennent du kit.
 */
import { runStdio } from '@repo/mcp-kit'
import { definition } from './server.js'

runStdio(definition)
