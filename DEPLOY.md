# Deploying on the VPS

Target: the self-hosting VPS and its convention (`~/infra/CLAUDE.md`, the single reference for infrastructure rules). Docker + Compose, one central Caddy container for HTTPS, images built by GitHub Actions and pulled by `~/infra/scripts/deploy.sh`.

```
Claude / ChatGPT / Cursor
        │ HTTPS
        ▼
Caddy container (~/infra/caddy, the only one publishing 80/443)
        ├── network web-mcp-paie-fr ──▶ container mcp-paie-fr :3000
        └── network web-mcp-<next>  ──▶ container mcp-<next>  :3000
```

**One server of this repository = one project on the VPS.** Everything is named after the server's package name (`servers/paie-fr/package.json` → `mcp-paie-fr`):

| Object | Value for paie-fr |
|---|---|
| Folder on the VPS | `~/apps/mcp-paie-fr/` (compose + `.env`, no source code) |
| Docker network | `web-mcp-paie-fr` |
| Container | `mcp-paie-fr` |
| Image | `ghcr.io/ewen02/mcp-fleet/mcp-paie-fr:<sha>` and `:latest` |
| Public URL | `https://mcp-paie-fr.137-74-175-232.sslip.io/mcp` |

The `/vps-deploy` and `/vps-domaine` Claude skills automate the VPS side of the steps below.

## 1. Once per repository

### GitHub
1. Create the repository and copy `github-setup/` into `.github/` (`dependabot.yml`, `workflows/ci.yml`, `workflows/rules-watch.yml`).
2. **Deploy key**: one per repository (the CI secrets are shared by all its servers anyway), restricted to this repository's projects:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/deploy-mcp-fleet -C "deploy-mcp-fleet" -N ""
   KEY=$(cat ~/.ssh/deploy-mcp-fleet.pub)
   ssh vps "echo 'command=\"/home/ubuntu/infra/scripts/deploy.sh mcp-paie-fr\",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding $KEY' >> ~/.ssh/authorized_keys"
   ```
   Adding a server later = adding its name after `deploy.sh` on that line.
3. **Settings › Secrets and variables › Actions**:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `SSH_HOST` | `137.74.175.232` |
   | Secret | `SSH_USER` | `ubuntu` |
   | Secret | `SSH_KEY` | `pbcopy < ~/.ssh/deploy-mcp-fleet` |
   | Secret | `SSH_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 137.74.175.232` |
   | Variable | `DEPLOY_ENABLED` | `true` (deployment is opt-in) |
   | Variable | `MCP_BASE_DOMAIN` | optional, default `137-74-175-232.sslip.io` (HTTPS smoke test: `https://<name>.<base>/health`) |

4. **Registry**: the VPS already pulls from GHCR (`docker login ghcr.io` done once for the machine). Nothing to do, whether the package is private or public.

### Caddy (central Caddyfile)
Merge the first two parts of [deploy/Caddyfile](./deploy/Caddyfile) into `~/infra/caddy/Caddyfile`, once:
- the `log default` filter, **inside** the existing global `{ … }` block: it removes client IPs and headers from Caddy's error logs, as promised in [PRIVACY.md](./PRIVACY.md);
- the `(mcp)` snippet, next to `(app)`. Why it differs from `(app)`: no access log, no compression, upstream keep-alive shorter than Node's (ARCHITECTURE.md, D24).

## 2. Once per server

Example for paie-fr. Order matters: network before Caddy, Caddy before the first deployment.

```bash
# 1. Network and folder
ssh vps 'docker network create web-mcp-paie-fr && mkdir -p ~/apps/mcp-paie-fr'

# 2. Compose and configuration
scp servers/paie-fr/deploy/docker-compose.yml vps:~/apps/mcp-paie-fr/
scp servers/paie-fr/deploy/.env.example vps:~/apps/mcp-paie-fr/.env
ssh vps 'chmod 600 ~/apps/mcp-paie-fr/.env && nano ~/apps/mcp-paie-fr/.env'   # ALLOWED_HOSTS = public domain

# 3. Caddy: attach it to the new network (two places in ~/infra/caddy/docker-compose.yml:
#    the service's `networks:` and the bottom `networks:` section), then recreate it
#    (~2 s interruption of every site, certificates are kept in named volumes)
ssh vps 'cd ~/infra/caddy && docker compose up -d'

# 4. Caddy: add the server's block from deploy/Caddyfile, validate BEFORE reloading
#    (an invalid file makes the reload fail while Caddy keeps serving the old config)
scp caddy/Caddyfile vps:~/infra/caddy/   # from your ~/infra checkout
ssh vps 'cd ~/infra/caddy && docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile </dev/null \
  && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null'

# 5. Whitelist the project on the repository's deploy key (see §1)
```

Then push to `main`. Check from the Internet, not from the server:

```bash
scripts/smoke-test.sh https://mcp-paie-fr.137-74-175-232.sslip.io
```

Finally, back up the new `.env` right away: `~/infra/scripts/backup-env.sh`.

## 3. What happens on each push

| Event | check | image | deploy |
|---|---|---|---|
| Pull request | lint, typecheck, tests, build, `pnpm audit` | build + hardened smoke test, not pushed | — |
| Push to `main` | same | build, smoke test, push `:<sha>` + `:latest` | `deploy mcp-paie-fr <sha>` over SSH, then HTTPS `/health` |

On the VPS, `deploy.sh` pulls the image of the commit, waits for `healthy` (the image probes every 2 s while starting: ~3 s), records the tag in `.deployed-tag`, and **rolls back to the previous tag** if the container does not become healthy. Its exit code fails the job: a broken deployment never shows a green check.

## 4. Operations

In `~/apps/mcp-paie-fr` on the VPS (`ssh vps`):

| Task | Command |
|---|---|
| Status | `docker compose ps` (should say `healthy`) |
| Logs | `docker compose logs -f --since 1h` |
| Tool usage today | `docker compose logs --since 24h \| grep '"event":"tool_call"'` |
| Version in service | `cat .deployed-tag` |
| Rollback | `IMAGE_TAG=<sha> docker compose up -d` (SHAs: GitHub › Packages, or `.deployed-tag` history in the CI runs) |
| Restart | `docker compose restart` |

Logs are JSON lines on stderr: `server_started`, `http_request` (method, path, status, duration, request id), `tool_call` (tool, outcome, duration). They never contain request bodies, tool arguments or IPs. Rotation is global to the machine (`/etc/docker/daemon.json`, 3 × 10 MB).

Monitoring: point an uptime checker at `https://<domain>/health`. Resource usage and limits: `/vps-ressources` (paie-fr: ~52 MB of the 512 MB personal profile).

## 5. Configuration reference

Environment variables of every server (validated at start-up by the kit; an invalid value stops the server with an `invalid_config` log line):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Port inside the container (always 3000 on the VPS) |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Listening interface |
| `ALLOWED_HOSTS` | localhost only | Public domain(s), comma-separated. **Required** in `.env`: any other `Host` is refused (DNS rebinding) |
| `ALLOWED_ORIGINS` | none | Only for browser-based clients |
| `TRUST_PROXY` | `false` (`true` in the compose) | Read the client IP from `X-Forwarded-For` (last entry, added by Caddy) |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per client IP, `0` disables. Claude/ChatGPT connectors share a few IPs across all their users: keep it generous |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

## 6. Rehearsing locally

The exact production chain can run on a Mac before a first deployment (this is how v0.5.0 was verified):

```bash
docker build --build-arg SERVER=paie-fr -t ghcr.io/ewen02/mcp-fleet/mcp-paie-fr:local .
docker network create web-mcp-paie-fr
# A folder shaped like ~/apps/mcp-paie-fr: the repo's compose + a .env with
# ALLOWED_HOSTS=mcp-paie-fr.127-0-0-1.sslip.io (sslip.io resolves it to 127.0.0.1)
IMAGE_TAG=local docker compose up -d --wait
# Caddy 2.11.4 on the same network, with deploy/Caddyfile + `local_certs` in the
# global block and the local domain, published on 127.0.0.1:8443
scripts/smoke-test.sh https://mcp-paie-fr.127-0-0-1.sslip.io:8443 --cacert caddy-root.crt
```

## 7. Adding a server to AI clients

Remote MCP URL: `https://<name>.137-74-175-232.sslip.io/mcp` (no authentication).

- **Claude** (web/desktop): Settings → Connectors → Add custom connector → paste the URL.
- **ChatGPT**: Settings → Connectors (developer mode) → Create → paste the URL.
- **Cursor**: `~/.cursor/mcp.json` → `{ "mcpServers": { "paie-fr": { "url": "https://<domain>/mcp" } } }`.

The menu names above change often; check each client's documentation if they differ.
