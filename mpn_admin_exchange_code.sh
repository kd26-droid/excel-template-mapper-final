#!/usr/bin/env bash
set -euo pipefail

# Exchange a Digi‑Key OAuth authorization code with your backend
# and persist tokens for silent MPN validation.
#
# Usage:
#   ./mpn_admin_exchange_code.sh <code> [base_url]
#
# Examples:
#   ./mpn_admin_exchange_code.sh mJJkrZNY
#   ./mpn_admin_exchange_code.sh mJJkrZNY http://localhost:8000
#   BASE_URL=https://your-backend.example.com ./mpn_admin_exchange_code.sh mJJkrZNY

RAW_INPUT="${1:-}"
BASE_URL="${2:-${BASE_URL:-http://localhost:8000}}"

if [[ -z "${RAW_INPUT}" ]]; then
  echo "Usage: $0 <code> [base_url]" >&2
  exit 1
fi

extract_code() {
  local s="$1"
  if [[ "$s" == http* ]]; then
    # Extract code param from full callback URL
    s=$(printf '%s' "$s" | sed -n 's#.*[?&]code=\([^&]*\).*#\1#p')
  fi
  printf '%s' "$s"
}

CODE=$(extract_code "$RAW_INPUT")
if [[ -z "$CODE" ]]; then
  echo "❌ Could not extract code from input. Provide the code or full callback URL." >&2
  exit 1
fi

EXCHANGE_URL="${BASE_URL%/}/api/mpn/admin/exchange-code/"
STATUS_URL="${BASE_URL%/}/api/mpn/auth/status/"

echo "➡️  Exchanging code with backend: ${EXCHANGE_URL}"
echo "    (base URL: ${BASE_URL})"

HTTP_BODY=$(mktemp)
HTTP_CODE=$(curl -sS -o "$HTTP_BODY" -w "%{http_code}" \
  -X POST "$EXCHANGE_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"${CODE}\"}") || {
  echo "❌ Request failed" >&2
  rm -f "$HTTP_BODY"
  exit 2
}

echo "Response (${HTTP_CODE}):"
cat "$HTTP_BODY"; echo

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "❌ Exchange failed (HTTP ${HTTP_CODE}). See response above." >&2
  rm -f "$HTTP_BODY"
  exit 3
fi

echo "\n✔️  Code exchanged. Verifying auth status…"
curl -sS "$STATUS_URL"; echo

echo "\n✅ Done. Your backend can now validate MPNs silently."
