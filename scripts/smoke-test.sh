#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Test de fumée d'un serveur MCP du dépôt, quel qu'il soit.
#
#   scripts/smoke-test.sh <url-de-base> [options curl…]
#   scripts/smoke-test.sh http://127.0.0.1:3000
#   scripts/smoke-test.sh https://mcp-paie-fr.137-74-175-232.sslip.io
#
# Vérifie : GET /health répond « ok », et un tools/list MCP renvoie au moins
# un tool. Utilisé par la CI sur chaque image avant publication, et à la main
# derrière Caddy. N'envoie aucune donnée personnelle.
# ---------------------------------------------------------------------------
set -euo pipefail

base="${1:?usage: smoke-test.sh <base-url> [curl options…]}"
shift
curl_opts=(--silent --show-error --fail --max-time 10 "$@")

health=$(curl "${curl_opts[@]}" "${base}/health")
node -e '
  const h = JSON.parse(process.argv[1])
  if (h.status !== "ok") throw new Error("health: " + process.argv[1])
  console.log(`health ok: ${h.name} ${h.version}`)
' "$health"

# Requête JSON-RPC brute, sans session (serveur stateless). La réponse peut
# être du JSON ou un flux SSE (`data: {…}`) : on accepte les deux.
body=$(curl "${curl_opts[@]}" -X POST "${base}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
node -e '
  const raw = process.argv[1]
  const json = raw.trimStart().startsWith("{")
    ? raw
    : raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("")
  const tools = JSON.parse(json).result?.tools ?? []
  if (tools.length === 0) throw new Error("tools/list: no tool in " + raw.slice(0, 300))
  console.log(`tools/list ok: ${tools.map((t) => t.name).join(", ")}`)
' "$body"
