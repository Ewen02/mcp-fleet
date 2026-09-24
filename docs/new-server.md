# Add a new MCP server in an evening

The kit already provides transports, HTTP guards, rate limiting, logs, telemetry, shutdown and the common output schemas. A new server only brings its **domain**, its **tools** and their **tests**. Budget: about 3 to 4 hours.

In the examples, the new server lives in `servers/demo-fr` and its package is `mcp-demo-fr`. Replace both everywhere. The package name is also the project name on the VPS (container, network, image, subdomain): kebab-case, lowercase, at most 49 characters.

## 0. Decide (15 min)

- **The source of truth.** Which official engine or dataset computes the answers? No rule is hand-coded in this repository (paie-fr uses the URSSAF engine). If there is none, the server probably does not belong here.
- **The tools.** Two or three, each answering one kind of question. A tool description is a prompt (ARCHITECTURE.md, D6): when to call it, what it returns, what it does not do, key French terms in parentheses.
- **The `source` field.** What will each result cite: engine version, date of the rules or data, license, documentation link?

## 1. Scaffold (15 min)

```bash
mkdir -p servers/demo-fr/src/domain servers/demo-fr/src/tools servers/demo-fr/test servers/demo-fr/deploy
cp servers/paie-fr/tsconfig.json servers/paie-fr/tsconfig.build.json servers/demo-fr/
```

`servers/demo-fr/package.json` (the scripts are the same for every server):

```json
{
  "name": "mcp-demo-fr",
  "version": "0.1.0",
  "description": "One sentence: what this server answers, and with which official source.",
  "license": "MIT",
  "private": true,
  "type": "module",
  "bin": {
    "mcp-demo-fr": "dist/stdio.js",
    "mcp-demo-fr-http": "dist/http.js"
  },
  "files": ["dist"],
  "scripts": {
    "dev:stdio": "tsx src/stdio.ts",
    "dev:http": "tsx src/http.ts",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "LOG_LEVEL=silent node --import tsx --test test/*.test.ts",
    "test:update-contract": "LOG_LEVEL=silent node --import tsx --test --test-update-snapshots test/contract.test.ts",
    "lint": "biome check ."
  },
  "dependencies": {
    "@modelcontextprotocol/server": "catalog:",
    "@repo/mcp-kit": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "catalog:"
  }
}
```

The server's definition, `src/server.ts`: everything the kit needs to know about it.

```ts
/**
 * Définition du serveur demo-fr : identité, factory MCP, champs de /health.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { type McpServerDefinition, readServerInfo } from '@repo/mcp-kit'
import { registerExampleTool } from './tools/example-tool.js'

export const SERVER_INFO = readServerInfo(new URL('../package.json', import.meta.url))

export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: 'What this server does, and that results must be quoted with their assumptions, warnings and source.',
  })
  // Ordre d'enregistrement = ordre de tools/list : il doit rester stable.
  registerExampleTool(server)
  return server
}

export const definition: McpServerDefinition = {
  info: SERVER_INFO,
  createServer,
  // Optionnel : ce que /health doit montrer en plus (version des données…).
  health: () => ({ data: { version: 'TODO' } }),
}
```

The two entry points, one line each. `src/stdio.ts` (the shebang must stay the very first line):

```ts
#!/usr/bin/env node
import { runStdio } from '@repo/mcp-kit'
import { definition } from './server.js'

runStdio(definition)
```

`src/http.ts`:

```ts
#!/usr/bin/env node
import { runHttp } from '@repo/mcp-kit'
import { definition } from './server.js'

runHttp(definition)
```

Then, from the root: `pnpm install` (links the kit into the new package) and `pnpm build`. A server imports the kit's **compiled** output (`packages/mcp-kit/dist`): Turborepo builds it for you in `pnpm check`, `pnpm test` or `pnpm turbo run … --filter=…`, but a bare `pnpm --filter <server> <script>` on a fresh clone would not find it.

## 2. Domain and tools (2 h)

- `src/domain/*.ts`: plain functions, camelCase, **no MCP import**. The only file allowed to talk to the engine is one `engine.ts` (D2, D3 in ARCHITECTURE.md).
- `src/tools/<tool>.ts`: an adapter. Public contract in snake_case, zod schemas, a text for the model, and the common trailer. For example `src/tools/example-tool.ts`:

```ts
/**
 * Adaptateur MCP : contrat public (snake_case) ↔ domaine (camelCase). Aucune règle ici.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { assumptionsSchema, instrument, READ_ONLY_ANNOTATIONS, warningsSchema } from '@repo/mcp-kit'
import * as z from 'zod/v4'

const inputSchema = z.object({
  text: z.string().min(1).max(1000).describe('What the tool receives, with the French term in parentheses (terme).'),
})

const outputSchema = z.object({
  result: z.string().describe('What the tool returns.'),
  assumptions: assumptionsSchema,
  warnings: warningsSchema,
  source: z.object({ name: z.string(), version: z.string(), documentation: z.string() }),
})

export type ExampleToolOutput = z.infer<typeof outputSchema>

export function registerExampleTool(server: McpServer): void {
  server.registerTool(
    'example_tool',
    {
      title: 'Example tool',
      description: 'When to call it, what it returns, what it does NOT do. Key French terms in parentheses.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    instrument('example_tool', async ({ text }) => {
      // Appel du domaine ici : jamais de calcul dans l'adaptateur.
      const result: ExampleToolOutput = {
        result: text,
        assumptions: ['Everything the user did not specify, stated explicitly'],
        warnings: [],
        source: { name: 'TODO: official source', version: 'TODO', documentation: 'https://…' },
      }
      return { content: [{ type: 'text', text: `Result: ${result.result}` }], structuredContent: result }
    }),
  )
}
```

Rules that apply to every server: [AGENTS.md](../AGENTS.md).

## 3. Tests (45 min)

Three kinds, all with `node:test`:

- **Domain tests** against reference values from the official source (like `servers/paie-fr/test/salary.test.ts` against the public URSSAF API). If the source changes version, these must break on purpose.
- **An end-to-end test** of the real server over stdio, in both protocol eras: copy `servers/paie-fr/test/stdio.e2e.test.ts` and adapt the tool names and values.
- **The contract snapshot**: copy `servers/paie-fr/test/contract.test.ts`, list a few representative calls, then generate it once:

```bash
pnpm --filter mcp-demo-fr test:update-contract   # the kit must be built (pnpm build)
pnpm check     # lint, typecheck, test, build of every package, from the root
```

The HTTP guards, rate limit, logs and shutdown are already tested in the kit: do not test them again.

## 4. Try it locally (10 min)

```bash
pnpm turbo run build --filter=mcp-demo-fr...   # the server and what it depends on (the kit)
```

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`), with the absolute path of `node`:

```json
{ "mcpServers": { "demo-fr": { "command": "/opt/homebrew/bin/node", "args": ["/Users/ewenlequere/Documents/DEV/mcp-fleet/servers/demo-fr/dist/stdio.js"] } } }
```

Ask real questions in French and in English, and check that the model picks the right tool and quotes assumptions, warnings and source. Fix the descriptions, not the model.

## 5. Image (10 min)

Nothing to write: the root `Dockerfile` builds any server.

```bash
docker build --build-arg SERVER=demo-fr -t mcp-demo-fr:test .
docker run -d --name demo --read-only --tmpfs /tmp --cap-drop ALL --user 1001:1001 -p 127.0.0.1:3000:3000 mcp-demo-fr:test
scripts/smoke-test.sh http://127.0.0.1:3000 && docker rm -f demo
```

## 6. Deployment files and VPS (30 min)

```bash
mkdir -p servers/demo-fr/deploy
sed 's/mcp-paie-fr/mcp-demo-fr/g' servers/paie-fr/deploy/docker-compose.yml > servers/demo-fr/deploy/docker-compose.yml
sed 's/mcp-paie-fr/mcp-demo-fr/g' servers/paie-fr/deploy/.env.example > servers/demo-fr/deploy/.env.example
```

Check the resource profile in the compose (512 MB / 1 CPU for a personal project), add the server's block to [deploy/Caddyfile](../deploy/Caddyfile), then follow [DEPLOY.md §2](../DEPLOY.md#2-once-per-server): network, folder, `.env`, Caddy network and block, and the project name added to the deploy key's whitelist.

Push to `main`: the CI sees that only `servers/demo-fr` changed, builds and smoke-tests **only** its image, and deploys **only** it.

## Checklist

- [ ] Package name `mcp-<folder>`, kebab-case; version 0.1.0
- [ ] No hand-coded rule; one `engine.ts` talks to the source; known gaps reported in `warnings`
- [ ] Every result has `assumptions`, `warnings`, `source`; every handler wrapped with `instrument()`
- [ ] Domain tests against official reference values; stdio e2e in both eras; contract snapshot
- [ ] `pnpm check` green from the root
- [ ] Image builds and passes `scripts/smoke-test.sh` with production hardening
- [ ] `deploy/docker-compose.yml`, `deploy/.env.example`, Caddy block, VPS steps, whitelist
- [ ] `README.md` of the server (tools, limitations, local setup) and a line in the root README's server table
- [ ] A decision in ARCHITECTURE.md if the server needed something the kit did not provide
