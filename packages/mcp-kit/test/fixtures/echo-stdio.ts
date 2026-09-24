/** Point d'entrée stdio du serveur « echo » : lancé en sous-process par stdio.test.ts. */
import { runStdio } from '../../src/run-stdio.js'
import { echoDefinition } from './echo-server.js'

runStdio(echoDefinition())
