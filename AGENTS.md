# Project conventions

Rules for anyone (human or AI agent) writing code in this repository.

## Language

- **Everything is written in English**: file names, identifiers, types, MCP tool names, JSON fields, tool descriptions, text returned to the model, error messages, test names, README and docs.
- **Code comments are written in French.**
- Exceptions (data, not code):
  - publicodes rule names from `modele-social` stay in French (`'salarié . contrat . salaire brut'`) — they are the engine's identifiers.
  - Tool descriptions keep key French terms in parentheses, e.g. "net salary before income tax (net à payer avant impôt)", so the model matches questions asked in French.

## Repository layout

- `packages/mcp-kit` (`@repo/mcp-kit`): the shared runtime. **It knows nothing about any domain**: no domain import, no domain term, not even in tests (they use the `echo` fixture server). What depends on a domain is injected through `McpServerDefinition` (`info`, `createServer`, `health`).
- `servers/<name>`: one MCP server = one package = one image = one container. Package name = project name on the VPS (`mcp-paie-fr`). A server imports the kit, never another server.
- A server imports the kit only from `@repo/mcp-kit` (its public API, `src/index.ts`), never from a kit file path.
- Shared dependency versions live in the `catalog:` of `pnpm-workspace.yaml` (MCP SDK, zod): write `"catalog:"` in `package.json`, never a second version.
- Adding a server: follow [docs/new-server.md](./docs/new-server.md).

## Every server

- Entry points are one line each: `runStdio(definition)` in `src/stdio.ts`, `runHttp(definition)` in `src/http.ts`.
- Every tool result returns `assumptions`, `warnings` (schemas from the kit) and `source` (defined by the server).
- Tool handlers are wrapped with `instrument()` from the kit (telemetry). Pure calculations use `READ_ONLY_ANNOTATIONS`.
- The domain (`src/domain/*`) never imports MCP. Tools (`src/tools/*`) only map the public contract (snake_case) to the domain (camelCase) and back.
- The public contract is snapshotted (`test/contract.test.ts`). Changing it is a decision: `pnpm build`, `pnpm --filter <package> test:update-contract`, then review the snapshot diff.

## paie-fr specifics

- `servers/paie-fr/src/domain/engine.ts` is the only file that imports `publicodes` / `modele-social`.
- Every publicodes situation for an employee starts from `employeeSituation()` (it sets `dirigeant: non`).
- Never patch a rule by hand: report known upstream gaps in `servers/paie-fr/src/domain/known-issues.ts`.
- Never hardcode a rate, ceiling or default value: read it from the engine.
- `modele-social` is pinned to an exact version. Upgrading it is a deliberate change: update the reference tests against the public API `https://mon-entreprise.urssaf.fr/api/v1/evaluate` and review `known-issues.ts`.

## Runtime

- stdio: nothing may write to stdout outside the MCP transport (stdout carries JSON-RPC). Log to stderr.
- Log through the kit's `logger` only. Never log request bodies, tool arguments or client IPs (they can be personal data).
- HTTP configuration only through environment variables validated in `packages/mcp-kit/src/config.ts`.

## Deployment

- Never build on the VPS: images are built by GitHub Actions and pulled by `~/infra/scripts/deploy.sh` (see [DEPLOY.md](./DEPLOY.md)).
- A server's compose file (`servers/<name>/deploy/docker-compose.yml`) never publishes a port: only the central Caddy does.

## Checks before committing

From the root (Turborepo runs them in dependency order and caches the results):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
# or everything at once:
pnpm check
```
