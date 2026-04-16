#!/usr/bin/env bash
# simulate-webhook.sh — send a fake Linear webhook to the local runtime.
#
# Usage:
#   ./scripts/simulate-webhook.sh <issueId> [state]
#
# Arguments:
#   issueId  Linear internal UUID (NOT the identifier like TRI-47).
#            Find it in the runtime logs after "Creating ticket..." or via:
#              curl -s http://localhost:3000/api/linear/issues | jq '.[].id'
#   state    "done" (default) | "in-review"
#
# Examples:
#   ./scripts/simulate-webhook.sh abc123-uuid-here
#   ./scripts/simulate-webhook.sh abc123-uuid-here in-review
#
# To find the issueId for a ticket you know by identifier (e.g. TRI-47):
#   docker exec triage-libsql-1 sh -c \
#     "sqld --version" 2>/dev/null || true
#   docker exec triage-runtime-1 node -e "
#     const { createClient } = require('@libsql/client');
#     const db = createClient({ url: 'http://libsql:8080' });
#     db.execute('SELECT linear_issue_id, title FROM local_tickets').then(r =>
#       r.rows.forEach(row => console.log(row.linear_issue_id, row.title))
#     );
#   "

set -euo pipefail

RUNTIME_URL="${RUNTIME_URL:-http://localhost:3000}"
ISSUE_ID="${1:-}"
STATE="${2:-done}"

if [ -z "$ISSUE_ID" ]; then
  echo "Usage: $0 <issueId> [done|in-review]"
  echo ""
  echo "Find issueId with:"
  echo "  docker exec triage-runtime-1 node -e \""
  echo "    const { createClient } = require('@libsql/client');"
  echo "    const db = createClient({ url: 'http://libsql:8080' });"
  echo "    db.execute('SELECT linear_issue_id, title FROM local_tickets').then(r =>"
  echo "      r.rows.forEach(row => console.log(row.linear_issue_id, row.title))"
  echo "    );\""
  exit 1
fi

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$STATE" = "in-review" ]; then
  PAYLOAD=$(cat <<EOF
{
  "action": "update",
  "type": "Issue",
  "data": {
    "id": "$ISSUE_ID",
    "identifier": "$ISSUE_ID",
    "state": {
      "name": "In Review",
      "type": "started"
    },
    "updatedAt": "$NOW"
  }
}
EOF
)
  echo "Simulating: In Review → evidence check for $ISSUE_ID"
else
  PAYLOAD=$(cat <<EOF
{
  "action": "update",
  "type": "Issue",
  "data": {
    "id": "$ISSUE_ID",
    "state": {
      "name": "Done",
      "type": "completed"
    },
    "updatedAt": "$NOW"
  }
}
EOF
)
  echo "Simulating: Done → resume workflow for $ISSUE_ID"
fi

echo "POST $RUNTIME_URL/api/webhooks/linear"
echo "$PAYLOAD" | jq . 2>/dev/null || echo "$PAYLOAD"
echo ""

RESPONSE=$(curl -s -X POST "$RUNTIME_URL/api/webhooks/linear" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
