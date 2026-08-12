#!/usr/bin/env bash
#
# End-to-end smoke test for the NobleSee site.
#
# Checks the things that are only true when the whole stack is wired up
# — Next renders, Payload queries, PostgreSQL answers, and the access
# rules do what they claim. The domain rules themselves are unit-tested
# in apps/web/src/domain/domain.test.ts; this is the HTTP-level pass
# that catches the wiring between them.
#
#   ./tools/smoke-test.sh                                # localhost:8093
#   BASE_URL=https://noblesee.com ./tools/smoke-test.sh  # or an explicit host
#
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8093}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() {
    FAIL=$((FAIL + 1))
    printf '  \033[31mFAIL\033[0m %s\n' "$1"
    [ $# -gt 1 ] && printf '       %s\n' "$2"
}

check_eq() { # description, actual, expected
    if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$3', got '$2'"; fi
}

check_contains() { # description, file, needle
    if grep -qF -- "$3" "$2"; then pass "$1"; else fail "$1" "missing: $3"; fi
}

check_not_contains() { # description, file, needle
    if grep -qF -- "$3" "$2"; then fail "$1" "unexpectedly present: $3"; else pass "$1"; fi
}

status_of() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

echo "NobleSee smoke test — $BASE_URL"
echo

# --- the stack is actually up -----------------------------------------
echo "stack"
check_eq "health endpoint reports ok" \
    "$(curl -s "$BASE_URL/health" | tr -d ' ' | grep -o '"status":"ok"' || true)" \
    '"status":"ok"'

# --- pages render -----------------------------------------------------
echo "pages"
for path in / /books /collections /about /books/analects /books/tao-te-ching; do
    check_eq "GET $path" "$(status_of "$BASE_URL$path")" 200
done
check_eq "unknown book is 404, not 500" "$(status_of "$BASE_URL/books/no-such-book")" 404

curl -s "$BASE_URL/books" >"$WORKDIR/catalog.html"
curl -s "$BASE_URL/books/analects" >"$WORKDIR/book.html"

# --- the catalog shows real seeded data -------------------------------
echo "catalog"
check_contains "catalog lists a seeded book" "$WORKDIR/catalog.html" "The Analects"
check_contains "catalog lists the other seeded book" "$WORKDIR/catalog.html" "Tao Te Ching"
check_contains "collection filter is offered" "$WORKDIR/catalog.html" "collection=chinese-classics"

curl -s "$BASE_URL/books?collection=personal-development" >"$WORKDIR/filtered.html"
check_contains "filter keeps the matching book" "$WORKDIR/filtered.html" "The Analects"
check_not_contains "filter excludes the non-matching book" "$WORKDIR/filtered.html" "Tao Te Ching"

# An unknown slug must yield an empty catalog, never the whole catalog —
# otherwise a typo silently defeats the filter.
curl -s "$BASE_URL/books?collection=does-not-exist" >"$WORKDIR/bogus.html"
check_not_contains "unknown collection yields nothing, not everything" \
    "$WORKDIR/bogus.html" "The Analects"

# --- the book page reflects the domain rules --------------------------
echo "book page"
check_contains "shows the original-script title" "$WORKDIR/book.html" "論語"
check_contains "shows the rights status" "$WORKDIR/book.html" "public domain"
check_contains "offers EPUB" "$WORKDIR/book.html" "EPUB"
check_contains "offers the three PDF sizes" "$WORKDIR/book.html" "Extra Large"

# The editable master is the source of truth, not a reader download.
check_not_contains "does not offer the DOCX master to readers" "$WORKDIR/book.html" "/docx"

# Staged release: part 1 open, later parts held for this reader.
check_contains "first part is readable" "$WORKDIR/book.html" "/read/analects/1"
check_contains "later parts are held back" "$WORKDIR/book.html" "Opens after the previous part"
check_not_contains "held-back part offers no download link" "$WORKDIR/book.html" "/download/3/"

# --- access control is server-side ------------------------------------
echo "access control"
# Anonymous readers must not be able to reach an artifact directly.
# Anything other than a redirect-to-login or an outright refusal here
# means the download path is not enforcing authorization.
DL_STATUS="$(status_of "$BASE_URL/download/2/epub")"
case "$DL_STATUS" in
    401 | 403 | 302 | 303) pass "anonymous download is refused ($DL_STATUS)" ;;
    404) fail "anonymous download is refused" "route not implemented yet (404)" ;;
    200) fail "anonymous download is refused" "SERVED THE FILE — authorization is missing" ;;
    *) fail "anonymous download is refused" "unexpected status $DL_STATUS" ;;
esac

# The admin must never be reachable without authentication.
ADMIN_BODY="$(curl -s "$BASE_URL/admin")"
if echo "$ADMIN_BODY" | grep -qiE 'login|email|password'; then
    pass "admin presents a login rather than the dashboard"
else
    fail "admin presents a login rather than the dashboard" "no login form found"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32m%d passed, 0 failed\033[0m\n' "$PASS"
else
    printf '\033[31m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
fi
exit $((FAIL > 0))
