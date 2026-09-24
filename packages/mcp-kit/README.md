# @repo/mcp-kit

Shared runtime of the MCP servers of this repository. It knows nothing about any domain: a server injects what is specific to it through an `McpServerDefinition`. Internal package: consumed with `workspace:*`, never published.

## What a server gets

| Export | Purpose |
|---|---|
| `McpServerDefinition` | The contract: `info` (name, version), `createServer()` (MCP factory, called per connection or per HTTP request), `health()` (fields added to `GET /health`) |
| `readServerInfo(url)` | Name and version from the server's own `package.json` |
| `runStdio(definition)` | Local entry point: stdio transport, logs on stderr, clean shutdown |
| `runHttp(definition)` | Remote entry point: configuration from the environment, stateless Streamable HTTP, guards, rate limit, process lifecycle |
| `createHttpApp(definition, options)` | The HTTP app itself, for tests (random port, explicit options) |
| `instrument(tool, handler)` | Wraps a tool handler: one `tool_call` log line (tool, outcome, duration), never the arguments |
| `assumptionsSchema`, `warningsSchema` | The common output trailer (every result also has a domain-specific `source`) |
| `READ_ONLY_ANNOTATIONS` | Tool annotations for pure calculations |
| `logger`, `createLogger`, `loadHttpConfig`, `createRateLimiter`, `rateLimitKey` | Lower-level building blocks |

## Minimal server

```ts
// src/server.ts
import { McpServer } from '@modelcontextprotocol/server'
import { type McpServerDefinition, readServerInfo } from '@repo/mcp-kit'

const info = readServerInfo(new URL('../package.json', import.meta.url))

export const definition: McpServerDefinition = {
  info,
  createServer: () => {
    const server = new McpServer(info)
    // server.registerTool(…)
    return server
  },
}

// src/stdio.ts → runStdio(definition)      src/http.ts → runHttp(definition)
```

Design rationale: ARCHITECTURE.md, D23 and D26.
