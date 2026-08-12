#!/bin/sh
# Fails if the domain layer imports a framework.
#
# MODERNIZATION.md sections 3 and 7 require the NobleSee domain to be
# able to exist independently of Payload. That is only true if it never
# imports it, and the only way that stays true is if something checks.
set -eu

VIOLATIONS=$(grep -rnE "from '(payload|next|react|pg|drizzle|@payloadcms)" src/domain/ || true)

if [ -n "$VIOLATIONS" ]; then
    echo "Domain boundary violated — src/domain must not import a framework:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "Domain boundary intact."
