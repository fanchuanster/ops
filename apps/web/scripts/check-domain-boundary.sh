#!/bin/sh
set -eu

VIOLATIONS=$(grep -rnE "from '(payload|next|react|pg|drizzle|@payloadcms)" src/domain/ || true)

if [ -n "$VIOLATIONS" ]; then
    echo "Domain boundary violated — src/domain must not import a framework:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "Domain boundary intact."
