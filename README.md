# mcp-paie-fr

MCP server that answers French payroll and income tax questions with the **open-source URSSAF engine** ([publicodes](https://publi.codes) + [modele-social](https://github.com/betagouv/mon-entreprise/tree/master/modele-social)). No rule is hand-coded: every result returns the model version and the year of the rules.

> Independent project, not affiliated with URSSAF. Amounts are estimates.

## Tools

| Tool | Status | Purpose |
|---|---|---|
| `gross_to_net` | ✅ | Gross → net before income tax, taxable net, employee contributions |
| `employer_cost` | ✅ | Gross → total employer cost, employer contributions, general reduction (RGDU) |
| `income_tax_estimate` | ✅ | Household income tax (scale, family quotient, discount), withholding tax, net after tax |

Every result includes `assumptions`, `warnings` (known limitations) and `source` (rules version and year).

### Known limitation

`modele-social` 11.1.0 (latest on npm) computes the general reduction (RGDU) with the June 2026 minimum wage, while the live URSSAF simulator uses the January 2026 one (fixed upstream, not yet released). `employer_cost` may be understated by about €5–110/month below ~3× SMIC; the tool says so in `warnings`. Net salary and income tax are unaffected.

## Getting started

```bash
npm install
npm run lint        # Biome (format + lint)
npm run typecheck
npm test            # domain tests (vs. the public URSSAF API) + stdio and HTTP e2e (2025 and 2026 protocol eras)
npm run build
```

### Local setup (stdio)

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) or Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "paie-fr": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/ewenlequere/Documents/DEV/mcp-paie-fr/dist/stdio.js"]
    }
  }
}
```

Use the absolute path of `node` (`which node`): desktop clients don't inherit your shell `PATH`. Restart the client, then ask: *"How much is €3,200 gross in net for an executive?"*, *"How much do I cost my employer?"*, *"How much income tax will I pay with 2 children?"*

### Remote setup (HTTP)

Production: Docker image + Compose + Caddy on a VPS, deployed by GitHub Actions. Full runbook in [DEPLOY.md](./DEPLOY.md).

Locally:

```bash
npm run build
PORT=3000 npm run start:http      # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP: no session, one server instance per request. Configuration by environment variables (see [DEPLOY.md](./DEPLOY.md#4-configuration-reference)).

Quick check by hand:

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"employer_cost","arguments":{"gross_salary":3200,"is_executive":true}}}'
```

### Debugging by hand

```bash
npm run inspect     # opens the MCP Inspector on the stdio server
```

Or straight JSON-RPC, to see what goes over the wire:

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gross_to_net","arguments":{"gross_salary":3000}}}' \
 | (cat; sleep 3) | node dist/stdio.js
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md): layers, request lifecycle, decisions and their rationale. Coding conventions are in [AGENTS.md](./AGENTS.md).

## Privacy

No data is stored, tool arguments are never logged. See [PRIVACY.md](./PRIVACY.md).

## License

MIT ([LICENSE](./LICENSE)). Calculation rules come from `modele-social` (MIT, © beta.gouv.fr) — see [NOTICE](./NOTICE).
