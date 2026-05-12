#!/usr/bin/env bash
# setup-webhook-ngrok.sh — expose the local runtime via ngrok and register
# the public URL as a Linear webhook for the configured team.
#
# Prerequisites:
#   1. ngrok installed: https://ngrok.com/download  (brew install ngrok)
#   2. ngrok authenticated: ngrok config add-authtoken <token>
#   3. Runtime running: docker compose up -d
#   4. LINEAR_API_KEY set in .env
#
# Usage:
#   ./scripts/setup-webhook-ngrok.sh
#
# What it does:
#   1. Starts ngrok tunnel on port 3000
#   2. Waits for the public URL
#   3. Calls POST /api/linear/webhook/setup with the public URL
#   4. Prints the webhook ID — save this, Linear doesn't let you list webhooks
#      easily so you'll need it to delete/update later.
#
# To stop:
#   Ctrl+C (kills ngrok tunnel; the Linear webhook remains registered)
#   To delete the webhook, go to Linear → Settings → API → Webhooks

set -euo pipefail

RUNTIME_URL="${RUNTIME_URL:-http://localhost:3000}"
NGROK_PORT="${NGROK_PORT:-3000}"
NGROK_API="${NGROK_API:-http://localhost:4040}"

# Check ngrok is installed
if ! command -v ngrok &>/dev/null; then
  echo "ERROR: ngrok not found. Install with:"
  echo "  brew install ngrok   # macOS"
  echo "  or download from https://ngrok.com/download"
  exit 1
fi

# Check runtime is up
if ! curl -sf "$RUNTIME_URL/api/health" >/dev/null 2>&1; then
  echo "ERROR: Runtime not responding at $RUNTIME_URL"
  echo "Start it with: docker compose up -d"
  exit 1
fi

echo "Starting ngrok tunnel on port $NGROK_PORT..."
ngrok http "$NGROK_PORT" --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok to be ready
for i in $(seq 1 15); do
  PUBLIC_URL=$(curl -sf "$NGROK_API/api/tunnels" 2>/dev/null | \
    grep -o '"public_url":"https://[^"]*"' | head -1 | \
    sed 's/"public_url":"//;s/"//')
  if [ -n "$PUBLIC_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$PUBLIC_URL" ]; then
  echo "ERROR: ngrok tunnel did not start in time. Check /tmp/ngrok.log"
  kill "$NGROK_PID" 2>/dev/null || true
  exit 1
fi

WEBHOOK_URL="$PUBLIC_URL/api/webhooks/linear"
echo "Tunnel ready: $PUBLIC_URL"
echo "Registering webhook: $WEBHOOK_URL"

RESPONSE=$(curl -s -X POST "$RUNTIME_URL/api/linear/webhook/setup" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$WEBHOOK_URL\"}")

echo ""
echo "Linear webhook setup response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

WEBHOOK_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

echo ""
echo "============================================"
echo "  ngrok tunnel:  $PUBLIC_URL"
echo "  webhook URL:   $WEBHOOK_URL"
if [ -n "$WEBHOOK_ID" ]; then
  echo "  webhook ID:    $WEBHOOK_ID"
fi
echo "============================================"
echo ""
echo "Linear will now send real webhook events to this session."
echo "Press Ctrl+C to stop ngrok (webhook stays registered in Linear)."
echo "To delete it: Linear → Settings → API → Webhooks"
echo ""

# Keep script alive so ngrok stays up
trap "echo ''; echo 'Stopping ngrok...'; kill $NGROK_PID 2>/dev/null || true" INT TERM
wait "$NGROK_PID"
