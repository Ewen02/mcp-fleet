# Project conventions

Rules for anyone (human or AI agent) writing code in this repository.

## Language

- **Everything is written in English**: file names, identifiers, types, MCP tool names, JSON fields, tool descriptions, text returned to the model, error messages, test names, README and docs.
- **Code comments are written in French.**
- Exceptions (data, not code):
  - publicodes rule names from `modele-social` stay in French (`'salarié . contrat . salaire brut'`) — they are the engine's identifiers.
  - Tool descriptions keep key French payroll terms in parentheses, e.g. "net salary before income tax (net à payer avant impôt)", so the model matches questions asked in French.

## Architecture

- `src/domain/engine.ts` is the only file that imports `publicodes` / `modele-social`.
- `src/domain/*` never imports MCP. Tools in `src/tools/*` only map the public contract (snake_case) to the domain (camelCase) and back.
- Every tool result returns `assumptions`, `warnings` and `source` (modele-social version, reference date, year, license, documentation link), using the shared schemas in `src/tools/shared.ts`.
- Every publicodes situation for an employee starts from `employeeSituation()` (it sets `dirigeant: non`).
- Never patch a rule by hand: report known upstream gaps in `src/domain/known-issues.ts`.
- Never hardcode a rate, ceiling or default value: read it from the engine.

## Runtime

- stdio: nothing may write to stdout outside the MCP transport (stdout carries JSON-RPC). Log to stderr.
- Log through `src/logger.ts` only. Never log request bodies, tool arguments or client IPs (salaries are personal data).
- HTTP configuration only through environment variables validated in `src/config.ts`.
- Every new tool handler is wrapped with `instrument()` (telemetry).
- `modele-social` is pinned to an exact version. Upgrading it is a deliberate change: update the reference tests against the public API `https://mon-entreprise.urssaf.fr/api/v1/evaluate` and review `src/domain/known-issues.ts`.

## Checks before committing

```bash
npm run lint && npm run typecheck && npm test
```
