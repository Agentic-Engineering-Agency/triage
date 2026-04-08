#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run: cp .env.example .env"
  exit 1
fi

CHANGEME_COUNT=$(grep -c "CHANGEME" "$ENV_FILE" || true)
if [ "$CHANGEME_COUNT" -gt 0 ]; then
  echo "ERROR: $CHANGEME_COUNT CHANGEME values found in $ENV_FILE:"
  grep -n "CHANGEME" "$ENV_FILE"
  exit 1
fi

echo "OK: All secrets configured in $ENV_FILE"
