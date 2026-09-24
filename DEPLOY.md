# Deploying on a VPS

Target: a Linux VPS with Docker + Compose, Caddy on the host for HTTPS, GitHub Actions for CI/CD.

```
Claude / ChatGPT / Cursor ──HTTPS──▶ Caddy (host, :443) ──HTTP──▶ 127.0.0.1:3000 ──▶ container mcp-paie-fr
```

## 1. One-time setup

### DNS
Create an `A` record (and `AAAA` if IPv6) for your MCP domain, e.g. `mcp-paie.example.com`, pointing to the VPS.

### Caddy (host)
```bash
sudo apt install -y caddy
# From deploy/Caddyfile: put the global options block at the very top of
# /etc/caddy/Caddyfile (once for all sites), then add the site block with your domain.
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
Caddy obtains and renews the TLS certificate automatically.
- `flush_interval -1`: MCP responses may be streamed (SSE).
- `keepalive 30s`: shorter than Node's 65 s keep-alive, so Caddy never reuses a connection Node is closing.
- The global `log` filter removes client IPs and headers from Caddy's error logs (it has no access log), as promised in [PRIVACY.md](./PRIVACY.md).

### Application directory
```bash
sudo mkdir -p /opt/mcp-paie-fr && sudo chown "$USER" /opt/mcp-paie-fr
cd /opt/mcp-paie-fr
# copy compose.yaml and .env.example from the repository, then:
cp .env.example .env && nano .env      # IMAGE, MCP_DOMAIN
```

### Registry access
The CI publishes the image to `ghcr.io/<github-user>/mcp-paie-fr`.
- Public repository: make the package public once (GitHub → Packages → mcp-paie-fr → Package settings → Change visibility).
- Private repository: `docker login ghcr.io` on the VPS with a token that has `read:packages`.

### First start
```bash
docker compose pull && docker compose up -d --wait
curl -s https://mcp-paie.example.com/health
```

## 2. Continuous deployment (GitHub Actions)

Every push to `main`: lint, typecheck, tests, build, `npm audit` → image pushed to GHCR (`latest` and `sha-<commit>`) → deployment over SSH → HTTPS smoke test.

Deployment runs only when you opt in. In the repository settings:

| Kind | Name | Value |
|---|---|---|
| Variable | `DEPLOY_ENABLED` | `true` |
| Variable | `MCP_DOMAIN` | `mcp-paie.example.com` |
| Variable | `VPS_APP_DIR` | `/opt/mcp-paie-fr` (optional, default) |
| Secret | `VPS_HOST` | VPS hostname or IP |
| Secret | `VPS_USER` | deploy user (member of the `docker` group) |
| Secret | `VPS_SSH_KEY` | private key of a key pair **dedicated to deployment** |
| Secret | `VPS_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <vps-host>` |

Tip: restrict the deploy key in `~/.ssh/authorized_keys` on the VPS (`from="<github-ip-ranges>"` or a forced command) if you want to go further.

The deployed tag is written into `.env` (`IMAGE_TAG=sha-…`), so a manual `docker compose up -d` keeps the same version.

## 3. Operations

| Task | Command (in `/opt/mcp-paie-fr`) |
|---|---|
| Status | `docker compose ps` (should say `healthy`) |
| Logs | `docker compose logs -f --since 1h` |
| Tool usage today | `docker compose logs --since 24h \| grep '"event":"tool_call"'` |
| Rollback | set `IMAGE_TAG=sha-<previous>` in `.env`, then `docker compose up -d --wait` |
| Restart | `docker compose restart` |

Logs are JSON lines on stderr: `server_started`, `http_request` (method, path, status, duration, request id), `tool_call` (tool, outcome, duration). They never contain request bodies or tool arguments.

Monitoring: point an uptime checker (Uptime Kuma, UptimeRobot…) at `https://<domain>/health`.

## 4. Configuration reference

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Port inside the container |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Listening interface |
| `ALLOWED_HOSTS` | localhost only | Public domain(s), comma-separated. Set by compose from `MCP_DOMAIN` |
| `ALLOWED_ORIGINS` | none | Only for browser-based clients |
| `TRUST_PROXY` | `false` (`true` in compose) | Read the client IP from `X-Forwarded-For`. Only behind a trusted proxy |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per client IP, `0` disables. Claude/ChatGPT connectors share a few IPs across all their users: keep it generous |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

An invalid value stops the server at startup with an `invalid_config` log line.

## 5. Adding the server to AI clients

Remote MCP URL: `https://<domain>/mcp` (no authentication).

- **Claude** (web/desktop): Settings → Connectors → Add custom connector → paste the URL.
- **ChatGPT**: Settings → Connectors (developer mode) → Create → paste the URL.
- **Cursor**: `~/.cursor/mcp.json` → `{ "mcpServers": { "paie-fr": { "url": "https://<domain>/mcp" } } }`.

The menu names above change often; check each client's documentation if they differ.
