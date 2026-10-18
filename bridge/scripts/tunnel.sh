#!/usr/bin/env bash
# Exposes the local bridge through a cloudflared quick tunnel and points the Manufact-hosted MCP
# server at it. Quick tunnels get revoked after a while; run this again when site_notes starts
# answering "fetch failed". Usage: bash scripts/tunnel.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8790}"; LOG=/tmp/manufact-brain-tunnel.log
SERVER="${MANUFACT_SERVER:-$(python3 -c "import json;print(json.load(open('../mcp/.mcp-use/cloud/link.json'))['serverId'])")}"
pkill -f "cloudflared tunnel" 2>/dev/null || true; sleep 1
nohup cloudflared tunnel --url "http://localhost:$PORT" > "$LOG" 2>&1 &
for _ in $(seq 1 60); do grep -qo "https://[a-z0-9-]*\.trycloudflare\.com" "$LOG" && break; sleep 1; done
URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$LOG" | head -1)
[ -n "$URL" ] || { echo "no tunnel URL in $LOG"; exit 1; }
sleep 4; echo "tunnel $URL → $(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$URL/health")"
cd ../mcp
npx mcp-use servers env set "$SERVER" "BRIDGE_URL=$URL" >/dev/null
npx mcp-use deploy -y 2>&1 | tail -1
echo "redeploying with BRIDGE_URL=$URL; follow with: npx mcp-use deployments list --server $SERVER"
