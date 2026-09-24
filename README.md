# mcp-fleet

All my MCP servers in one place, built in public on a shared kit. Each server is one container and one subdomain; the kit gives them the same transports, safeguards, logs and deployment. No domain rule is hand-coded: each server relies on an authoritative source (an official engine, an open dataset) and says where every answer comes from.

> Independent projects. Results are estimates; each server states its sources and known limitations, and its own disclaimer (e.g. paie-fr is not affiliated with URSSAF).

## Servers

| Server | Package | Tools | Status |
|---|---|---|---|
| [paie-fr](./servers/paie-fr) | `mcp-paie-fr` | `gross_to_net`, `employer_cost`, `income_tax_estimate` | ✅ v0.5.0 |

Every tool result includes `assumptions`, `warnings` (known limitations) and `source` (engine version, date of the rules, documentation link).

## Repository layout

```
packages/
  mcp-kit/            @repo/mcp-kit: stdio and HTTP transports, config, logs, rate limit,
                      telemetry, common schemas. Knows nothing about any domain.
servers/
  paie-fr/            mcp-paie-fr: URSSAF engine, domain, tools, tests, deploy files
docs/new-server.md    add a new MCP server in an evening
deploy/Caddyfile      Caddy fragment for the VPS (one block per server)
scripts/              smoke test, list of servers affected by a change (CI)
github-setup/         GitHub Actions and Dependabot files, to copy into .github/
```

Why this split and where the boundary is: [ARCHITECTURE.md](./ARCHITECTURE.md) (D23). Coding conventions: [AGENTS.md](./AGENTS.md).

## Getting started

Requires Node ≥ 22.13 and pnpm (any recent pnpm switches itself to the version pinned in `packageManager`, or run `corepack enable`).

```bash
pnpm install
pnpm check          # lint + typecheck + test + build, every package, via Turborepo
```

Or one task at a time, still from the root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Turborepo builds the kit before the servers that depend on it and replays cached results for what did not change.

Work on one package (Turborepo still builds what it depends on first): `pnpm turbo run test --filter=mcp-paie-fr`, `pnpm turbo run build --filter=@repo/mcp-kit`.

## Using a server

Per-server instructions (tools, local setup in Claude Desktop or Cursor, debugging): see each server's README, e.g. [servers/paie-fr](./servers/paie-fr/README.md).

Remote servers run on a VPS behind Caddy, one container and one subdomain per server, deployed by GitHub Actions only when they changed: [DEPLOY.md](./DEPLOY.md).

## Adding a server

[docs/new-server.md](./docs/new-server.md): the files to create, the checks, and the four steps on the VPS.

## Privacy

No data is stored, tool arguments are never logged. See [PRIVACY.md](./PRIVACY.md).

## License

MIT ([LICENSE](./LICENSE)). Third-party rules and data used by a server are credited in its folder (e.g. [servers/paie-fr/NOTICE](./servers/paie-fr/NOTICE)).
