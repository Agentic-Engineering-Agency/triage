#!/usr/bin/env bash
# simulate-webhook.sh — send a signed, fake Linear webhook to the local runtime.
#
# Since the webhook signature verification landed, this script signs the
# payload with HMAC-SHA256 using the Linear webhook secret stored in the
# `webhook_secrets` table (populated by POST /api/linear/webhook/setup).
#
# Usage:
#   ./scripts/simulate-webhook.sh <issueId> [state]
#
# Arguments:
#   issueId  Linear internal UUID (NOT the identifier like TRI-47).
#   state    "done" (default) | "in-review"
#
# Environment:
#   RUNTIME_URL      default http://localhost:4111
#   WEBHOOK_SECRET   override; otherwise read from libsql webhook_secrets
#   CONTAINER        runtime container name (default: triage-runtime-1)
#
# Finding an issueId (e.g. TRI-47):
#   docker exec triage-runtime-1 node -e "
#     const { createClient } = require('@libsql/client');
#     (async () => {
#       const db = createClient({ url: 'http://libsql:8080' });
#       const r = await db.execute('SELECT issue_id, issue_url, status FROM workflow_runs ORDER BY created_at DESC LIMIT 5');
#       r.rows.forEach(row => console.log(row.issue_id, '|', row.issue_url, '|', row.status));
#     })();"

set -euo pipefail

RUNTIME_URL="${RUNTIME_URL:-http://localhost:4111}"
CONTAINER="${CONTAINER:-triage-runtime-1}"
ISSUE_ID="${1:-}"
STATE="${2:-done}"

if [ -z "$ISSUE_ID" ]; then
  echo "Usage: $0 <issueId> [done|in-review]" >&2
  exit 1
fi

# ─── Resolve the signing secret ─────────────────────────────────────────────
resolve_secret() {
  if [ -n "${WEBHOOK_SECRET:-}" ]; then
    printf '%s' "$WEBHOOK_SECRET"
    return 0
  fi
  docker exec "$CONTAINER" node -e "
    const { createClient } = require('@libsql/client');
    (async () => {
      const db = createClient({ url: 'http://libsql:8080' });
      const r = await db.execute(\"SELECT secret FROM webhook_secrets WHERE provider='linear' LIMIT 1\");
      if (r.rows[0]) process.stdout.write(String(r.rows[0].secret));
    })().catch(() => process.exit(1));
  " 2>/dev/null
}

SECRET="$(resolve_secret || true)"
if [ -z "$SECRET" ]; then
  cat <<EOF >&2
error: no Linear webhook secret available.

  • Register the webhook (POST /api/linear/webhook/setup) so the secret is
    persisted to the webhook_secrets table, OR
  • Export WEBHOOK_SECRET=<secret> before re-running this script.

The runtime will return 503 SECRET_NOT_CONFIGURED until a secret is stored.
EOF
  exit 1
fi

# ─── Build the payload ──────────────────────────────────────────────────────
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TS_MS="$(( $(date +%s) * 1000 ))"

if [ "$STATE" = "in-review" ]; then
  PAYLOAD=$(cat <<EOF
{"action":"update","type":"Issue","data":{"id":"$ISSUE_ID","identifier":"$ISSUE_ID","state":{"name":"In Review","type":"started"},"updatedAt":"$NOW_ISO"},"webhookTimestamp":$TS_MS}
EOF
)
  echo "Simulating: In Review → evidence check for $ISSUE_ID"
else
  PAYLOAD=$(cat <<EOF
{"action":"update","type":"Issue","data":{"id":"$ISSUE_ID","state":{"name":"Done","type":"completed"},"updatedAt":"$NOW_ISO"},"webhookTimestamp":$TS_MS}
EOF
)
  echo "Simulating: Done → resume workflow for $ISSUE_ID"
fi

# ─── Sign & send ────────────────────────────────────────────────────────────
# HMAC-SHA256 hex of the exact request body. `awk '{print $NF}'` normalises
# openssl's output across versions ("(stdin)= <hex>" vs "<hex> *stdin").
SIG="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

echo "POST $RUNTIME_URL/api/webhooks/linear"
echo "$PAYLOAD" | jq . 2>/dev/null || echo "$PAYLOAD"
echo "linear-signature: $SIG"
echo "linear-timestamp: $TS_MS"
echo ""

RESPONSE=$(curl -s -X POST "$RUNTIME_URL/api/webhooks/linear" \
  -H "Content-Type: application/json" \
  -H "linear-signature: $SIG" \
  -H "linear-timestamp: $TS_MS" \
  -d "$PAYLOAD")

echo "Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
