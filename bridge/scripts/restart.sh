#!/usr/bin/env bash
# Restarts the local bridge: stops whatever holds the port, waits until it is free, starts
# the server in the background and prints the health line. Usage: bash scripts/restart.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-$(grep '^PORT=' .env | cut -d= -f2)}"; PORT="${PORT:-8787}"
LOG="${LOG:-/tmp/manufact-brain-bridge.log}"
pids=$(lsof -ti ":$PORT" -sTCP:LISTEN || true)
if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; for _ in $(seq 1 40); do lsof -ti ":$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done; fi
if lsof -ti ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then kill -9 $(lsof -ti ":$PORT" -sTCP:LISTEN) 2>/dev/null || true; sleep 1; fi
if lsof -ti ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $PORT still busy"; exit 1; fi
PORT="$PORT" nohup node server.js > "$LOG" 2>&1 &
for _ in $(seq 1 40); do curl -sf "localhost:$PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -s "localhost:$PORT/health"; echo; echo "pid $(lsof -ti ":$PORT" -sTCP:LISTEN) · log $LOG"
