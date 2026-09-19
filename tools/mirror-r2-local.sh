#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="noblesee"

set -a
# shellcheck disable=SC1091
. "$REPO/.env"
set +a

ACCOUNT="$(grep -E '^\s*account_id' "$REPO/infra/terraform.tfvars" | cut -d'"' -f2)"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "$ACCOUNT" ]; then
    echo "Need CLOUDFLARE_API_TOKEN in .env and account_id in infra/terraform.tfvars." >&2
    exit 1
fi

echo "Listing objects in $BUCKET..."
KEYS="$(curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/r2/buckets/$BUCKET/objects?per_page=1000" |
    grep -o '"key":"[^"]*"' | cut -d'"' -f4)"

if [ -z "$KEYS" ]; then
    echo "No objects returned. Check the token's R2 permission with ./infra/check-token." >&2
    exit 1
fi

COUNT="$(printf '%s\n' "$KEYS" | wc -l)"
echo "$COUNT objects. Mirroring into local R2..."

KEYFILE="$REPO/apps/web/.r2-mirror-keys"
printf '%s\n' "$KEYS" >"$KEYFILE"
trap 'rm -f "$KEYFILE"' EXIT

"$REPO/apps/web/cf" bash -s <<'INNER'
set -euo pipefail
mkdir -p /tmp/mirror
while read -r key; do
    [ -n "$key" ] || continue
    mkdir -p "/tmp/mirror/$(dirname "$key")"
    npx wrangler r2 object get "noblesee/$key" --remote --file "/tmp/mirror/$key" >/dev/null 2>&1
    npx wrangler r2 object put "noblesee/$key" --local --file "/tmp/mirror/$key" >/dev/null 2>&1
    printf '  %s (%s bytes)\n' "$key" "$(stat -c%s "/tmp/mirror/$key")"
done < .r2-mirror-keys
INNER

echo "Done. Restart \`wrangler dev\` if it was already running."
