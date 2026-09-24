# Architecture

This document explains **why** the code is organized this way. It grows with each build step.

## Overview

A monorepo of MCP servers sharing one runtime kit. Paths below are relative to the repository root; `kit/` stands for `packages/mcp-kit/src`, `paie-fr/` for `servers/paie-fr/src`.

```
MCP client (Claude, Cursor, ChatGPT…)
        │  JSON-RPC 2.0
        ▼
┌───────────────────────────┐  ── packages/mcp-kit (@repo/mcp-kit): knows nothing about any domain ──
│ Transport                 │  kit/run-stdio.ts    (local: serveStdio + shutdown)
│                           │  kit/run-http.ts     (remote: config + listen + process lifecycle)
│                           │  kit/http-app.ts     (routes, guards, rate limit, MCP handler, /health)
│                           │  kit/config.ts       (env → validated config, fail fast)
├───────────────────────────┤
│ Cross-cutting             │  kit/logger.ts       (JSON lines on stderr, no personal data)
│                           │  kit/telemetry.ts    (one log line per tool call)
│                           │  kit/schemas.ts      (assumptions, warnings, read-only annotations)
├───────────────────────────┤
│ Contract                  │  kit/definition.ts   McpServerDefinition { info, createServer, health }
╞═══════════════════════════╡  ── servers/paie-fr (mcp-paie-fr): injects its definition into the kit ──
│ Entry points              │  paie-fr/stdio.ts, paie-fr/http.ts   one line each: runStdio / runHttp
├───────────────────────────┤
│ MCP server (definition)   │  paie-fr/server.ts   identity, factory wiring the tools, /health fields
├───────────────────────────┤
│ Tool adapters             │  paie-fr/tools/*.ts  public contract: schemas, LLM text
├───────────────────────────┤
│ Domain                    │  paie-fr/domain/salary.ts        net, employer cost
│                           │  paie-fr/domain/income-tax.ts    household income tax
│                           │  paie-fr/domain/known-issues.ts  upstream gaps, per version
├───────────────────────────┤
│ Engine                    │  paie-fr/domain/engine.ts        only file talking to publicodes
└───────────────────────────┘
        │
        ▼
  publicodes + modele-social (URSSAF rules)
```

Each layer only knows the one below it. The transport can change without touching the tools, the engine version can change without touching the MCP contract, and a new server reuses the whole upper half without copying it (D23).

## Lifecycle of a `tools/call` request

1. The client sends `{"method":"tools/call","params":{"name":"gross_to_net","arguments":{…}}}`.
2. The **transport** reads the message (a line on stdin, or a `POST /mcp` over HTTP, after the Host/Origin/size guards).
3. The SDK determines the protocol **era**: `legacy` (2025-11-25, after an `initialize`) or `modern` (2026-07-28, version carried in each request's `_meta`). The same factory serves both.
4. The SDK **validates the arguments** against the zod schema. Invalid → an error is returned to the model and the handler is never called.
5. The **handler** maps snake_case → domain, calls `computeGrossToNet`, maps back.
6. The SDK **validates the output** against `outputSchema`, then returns `content` (text for the LLM) + `structuredContent` (typed JSON).

## Decisions

### D1 — SDK v2 (`@modelcontextprotocol/server`), not `@modelcontextprotocol/sdk`
The 2026-07-28 spec makes MCP stateless (no more `initialize` or `Mcp-Session-Id`). SDK v2 implements it **and** automatically serves 2025 clients. Starting on v1 means a forced migration in a few months.

### D2 — Domain separated from tools
`paie-fr/domain` knows nothing about MCP. Benefits: unit tests without the protocol, reusable (REST API, CLI, widget), and the public contract (`gross_salary`, snake_case) can evolve independently from the internal model (`grossSalary`).
Cost: ~10 lines of mapping per tool. Accepted.

### D3 — Engine parsed once, copied per request
Parsing the ~650 rules costs ~600 ms → done when the module loads. Each calculation works on a `shallowCopy()` (~2 ms) so no situation is ever shared between two requests. Required as soon as we move to concurrent HTTP.

### D4 — Traceability in every result
`source` = modele-social version, reference date of the rules (read from the engine, never hardcoded), license, link to the official documentation of the calculation. `assumptions` = everything the user did not specify, read from the engine's default values. An LLM quoting a figure must be able to say where it comes from.

### D5 — `modele-social` pinned to an exact version
A new version = new rates = different results. Upgrading must be a decision (reference tests that break, changelog, post), not a side effect of `npm install`.

### D6 — A tool description is a prompt
It says when to call the tool, what it returns and **what it does not do** ("does not compute income tax"). This keeps the model from calling the wrong tool once there are three. Key French terms stay in parentheses so questions asked in French still match.

### D7 — `readOnlyHint` / `idempotentHint` annotations
A pure calculation has no side effects: the client can call it without asking the user for confirmation.

### D8 — stdout is sacred in stdio
stdout carries JSON-RPC. The publicodes logger is redirected to stderr; no `console.log` in the code.

### D9 — English codebase, French comments
Code, contract and docs are in English (public repo, portfolio, better tool selection by models). Comments stay in French. French publicodes rule names are engine data and are kept as-is. See [AGENTS.md](./AGENTS.md).

### D10 — Known upstream gaps are reported, never patched
`modele-social` 11.1.0 (npm) and the live URSSAF simulator disagree on the RGDU (June vs January 2026 SMIC; fixed upstream in `next`, unreleased). Patching the rule by hand would break the "no hand-coded rules" promise. Instead `known-issues.ts` lists gaps per version, and they surface in the `warnings` field. Upgrading the version removes them automatically; the pinned-version test forces a review.

### D11 — Every output has the same trailer: `assumptions`, `warnings`, `source`
`assumptions` and `warnings` schemas are shared by every server (`kit/schemas.ts`, D23); `source` is domain-specific (`paie-fr/tools/shared.ts`). A client or an agent can rely on the same shape whatever the tool.

### D12 — `dirigeant: non` in every situation
`modele-social` also powers the company-director simulator and defaults `dirigeant` to `oui`. Without forcing it to `non`, the taxable income of an employee is 0 and the income tax is 0. Found while building `income_tax_estimate`; set once in `employeeSituation()`.

### D13 — Income tax uses the standard scale only
The engine also offers "neutral rate" and "personalised rate", which reproduce a payslip. They don't answer "how much tax will I pay?", so the tool only exposes the standard scale (progressive scale, family quotient, discount, CEHR).

### D14 — Income tax figures rounded to the euro
The administration rounds taxable income and tax to the nearest euro (art. 1657 CGI), and the engine already does it for the withholding. Before this, the tool returned €3,063.68 of tax for €3,064 withheld. Found by running real questions through Claude Desktop.

### D15 — Alsace-Moselle as an explicit boolean
The engine derives the local regime from the establishment's département. Users know where they work, not their commune code, so the tools expose `alsace_moselle` and set the rule directly. Shared by the three tools through `employeeFields` / `employeeSituation()`.

### D16 — HTTP is stateless, same factory as stdio
`createMcpHandler(createServer)` builds a fresh `McpServer` per request (cheap: the rules are parsed once per process). No session store, so the server scales horizontally and survives restarts. 2025-era clients (`initialize`) are served statelessly too (`legacy: 'stateless'`).

### D17 — HTTP guards before the protocol
`Host` allow-list (DNS rebinding), `Origin` allow-list (requests without `Origin`, i.e. server-to-server clients, pass), 64 KiB body limit (a tool call is < 1 KiB), `/mcp` only. Configuration comes from the environment (`kit/run-http.ts`), the app itself is a pure function of its options (`kit/http-app.ts`) so tests start it on a random port.

### D18 — No request body in logs
A salary is personal data. Logs contain method, path, status and duration only. Nothing is stored: the server holds no user data at all, which keeps GDPR scope minimal.

### D19 — One typing cast, documented
The SDK types `method?: string` without `| undefined`; with `exactOptionalPropertyTypes`, Node's `IncomingMessage` is not assignable although it is the expected object. `asMcpRequest()` isolates that single cast.

### D20 — Production decisions (v0.4)
- **Fail fast on configuration**: env vars parsed with zod in `config.ts`; an invalid value stops the process with a clear `invalid_config` log.
- **One log format**: JSON lines on stderr for both transports (stdout is reserved for JSON-RPC in stdio). Events: `server_started`, `http_request`, `tool_call`, errors. No dependency (pino would be overkill here).
- **Tool telemetry = product metrics**: `instrument()` logs tool name, outcome and duration for every call. It answers "which tools are used, how often, how fast" without storing any argument.
- **Rate limit per IP, generous by default** (600/min): an anti-abuse guard, not a quota, because Claude/ChatGPT connectors call from a few shared IPs. Behind Caddy, only the last `X-Forwarded-For` entry is trusted (tested end to end: a forged header does not bypass the limit). IPv6 clients are grouped by /64 (an address per request would otherwise bypass it) and the table is capped at 100k keys (bounded memory).
- **Timeouts**: Node keep-alive (65 s) longer than the proxy's, to avoid random 502s on reused connections.
- **Process lifecycle**: crash on uncaught errors (Docker restarts cleanly), graceful shutdown on SIGTERM with an 8 s cap (Docker kills after 10 s). Shutdown order matters: stop accepting and close idle connections, let in-flight requests finish, then close the MCP handler (the reverse failed in-flight 2026-era calls; covered by a test that fails with the old order).
- **Nothing in the request path may throw outside the try**: the path is parsed once, without throwing; an invalid request target (`//a:99999/`) gets a 400. Before this fix, one such request crashed the process.
- **Single version source**: the server's `package.json`, read at runtime (`readServerInfo()` in the kit since D23).
- **Container**: multi-stage build, production dependencies only, non-root user, read-only filesystem, all capabilities dropped, memory/CPU/PID limits, healthcheck on `/health`, bound to `127.0.0.1` behind Caddy. Measured: ~55 MB RAM idle, stop in 0.2 s.
- **Data minimization**: no Caddy access log (it would write client IPs to disk); the app logs requests without IP or body.
- **CI/CD**: lint (Biome), typecheck, tests, build and `npm audit` on every PR; on `main`, image pushed to GHCR (`sha-…` + `latest`) and deployed over SSH with `docker compose up --wait`, then an HTTPS smoke test. Deployment is opt-in (`DEPLOY_ENABLED`).
- **Rules freshness**: a weekly workflow opens an issue when a new `modele-social` is published. Upgrades stay manual (D5); Dependabot ignores `modele-social`.

### D21 — Say what is not computed
`employer_cost` states the default work-accident rate (AT/MP) in `assumptions` and warns when the transport tax (versement mobilité) applies but cannot be computed (11+ employees, rate depends on the commune). The engine decides applicability; no threshold is hardcoded.

### D22 — Independent review before going live
A separate review pass (code reading + reproduction against the built image behind Caddy) found 7 issues, all fixed: a single-request crash, shutdown order, client IPs in Caddy error logs, IPv6 rate-limit bypass and unbounded memory, keep-alive race with Caddy, deploys cancellable by a new push, base image invisible to Dependabot. Lesson: tests written by the author mostly confirm the author's model; an adversarial pass finds what the model missed.

### D23 — Monorepo: one kit, several servers (pnpm workspaces + Turborepo)
The project is meant to host several MCP servers. Everything that is not a domain (transports, HTTP guards, rate limit, logs, telemetry, config, shutdown, common output schemas) was the same for all of them; copying it per server means fixing each bug N times. So:

- **`packages/mcp-kit`** holds that infrastructure and **knows nothing about any domain**. What depends on the domain is **injected** by the server through one object, `McpServerDefinition { info, createServer, health }`: its identity, its MCP factory, and the fields it adds to `GET /health` (paie-fr adds the rules vintage). The kit never imports a server; a server's entry points are one line each (`runStdio(definition)`, `runHttp(definition)`).
- **`servers/<name>`** holds the domain, the tools and the domain tests. One server = one package = one image.
- **Where the boundary is**: *in the kit* if every server needs it identically (a guard, a log rule, the `assumptions`/`warnings` schemas of the output trailer from D11). *In the server* if it names a domain concept (`sourceSchema` with `modele_social_version`, `employeeFields`, the text footer).
- **pnpm** because it enforces the boundary: a package can only import what it declares, so the kit physically cannot import a server (no phantom dependencies). A **catalog** (`pnpm-workspace.yaml`) gives shared dependencies one version: the kit and the servers must use the same instance of the MCP SDK and of zod, whose schemas the SDK converts to JSON Schema. pnpm 11 rather than 12: pnpm 12 ships a native binary that corepack (Node 22) cannot start, and pnpm 11 keeps the lockfile format read by Turborepo and Dependabot. pnpm 11 also refuses dependency install scripts unless allowed (`allowBuilds`).
- **Turborepo** runs `lint`, `typecheck`, `test`, `build` from the root in dependency order (`dependsOn: ["^build"]`: the kit is compiled before a server is type-checked, tested or built), and caches results.
- **The kit is a compiled internal package** (`dist/` + `.d.ts`, `exports` in its `package.json`), consumed with `workspace:*`: what runs in production is what the tests import. It is **not published** and there are **no changesets**: with one consumer, a version number for the kit would be ceremony. To revisit when a second repository needs it.
- **Cost**: one more build step before server tests, and two `package.json` to keep aligned through the catalog. Accepted.

### D26 — Shutdown closes kept-alive connections after the in-flight response
Found while moving the HTTP app into the kit: the graceful-shutdown test took 63 s. `server.close()` only closes connections idle *at that moment*; the connection serving an in-flight request stayed open after its response until Node's keep-alive timeout (65 s). In production, a SIGTERM during a request therefore ended in `forced_exit` after the 8 s cap, with exit code 1. Now, during shutdown, responses carry `Connection: close` (or the socket is ended after the response when headers are already sent), so the process stops right after the last response. The test asserts `close()` finishes in under 5 s (58 ms measured); the whole test suite went from ~65 s to ~7 s. This is the only behavior change of the monorepo migration.

## Tests

Run from the root with `pnpm test` (Turborepo, in dependency order).

**`packages/mcp-kit/test`**: the infrastructure, with a domain-free `echo` server (`test/fixtures/echo-server.ts`).
- `http-app.test.ts`: the HTTP app on a random port + the official Streamable HTTP client in both eras, the injected `/health` fields, the guards (foreign Host, foreign Origin, oversized body, 404, invalid target, request id), rate limiting and `X-Forwarded-For` trust, graceful shutdown with a request really in flight (D26).
- `stdio.test.ts`: stdout carries only JSON-RPC even at `LOG_LEVEL=debug`; logs go to stderr (D8).
- `config.test.ts`, `rate-limit.test.ts`: safe defaults, fail-fast configuration, key normalization (IPv4-mapped, IPv6 /64), window reset, bounded memory.
- `logger.test.ts`, `telemetry.test.ts`, `server-info.test.ts`: JSON lines and levels; one line per tool call without arguments or error messages; identity read from the server's `package.json`.

**`servers/paie-fr/test`**: the domain and the server.
- `salary.test.ts`, `employer-cost.test.ts`, `income-tax.test.ts`: the domain, against reference values from the public mon-entreprise.urssaf.fr API (`POST /api/v1/evaluate`).
- `stdio.e2e.test.ts`: the real server as a subprocess + the official client, all three tools, in both protocol eras.
- `http.e2e.test.ts`: the server's definition on the kit's HTTP app, both eras, `/health` with the rules vintage.
