#!/usr/bin/env bash
#
# End-to-end smoke test for the NobleSee site.
#
# Checks the things that are only true when the whole stack is wired up
# — Next renders, Payload queries, D1 answers, R2 hands back real bytes,
# and the access rules do what they claim. The domain rules are unit-tested
# in apps/web/src/domain/domain.test.ts; this is the HTTP-level pass
# that catches the wiring between them.
#
#   ./tools/smoke-test.sh                                # the local Worker (wrangler dev)
#   BASE_URL=https://noblesee.com ./tools/smoke-test.sh  # read-only against production
#
#   BASE_URL=https://noblesee.com ALLOW_WRITES=1 ./tools/smoke-test.sh
#                                                        # ...including the write tests
#
# The signed-in section registers readers and records deliveries, so it
# writes to whatever database BASE_URL is pointed at. Run against
# production it leaves real accounts and ledger rows behind — which is
# how noblesee.com ended up with four @noblesee.test readers. Those
# checks are therefore skipped for a non-local host unless ALLOW_WRITES
# says otherwise; everything read-only still runs.
#
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Local hosts are disposable, so writing to them needs no ceremony.
case "$BASE_URL" in
    http://localhost*|https://localhost*|http://127.0.0.1*|https://127.0.0.1*|http://0.0.0.0*)
        WRITES_OK=1 ;;
    *)
        WRITES_OK="$([ "${ALLOW_WRITES:-0}" = "1" ] && echo 1 || echo 0)" ;;
esac

PASS=0
FAIL=0
SKIP=0

pass() { PASS=$((PASS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  \033[33mskip\033[0m %s\n' "$1"; }
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

# The editable master is the source of truth and is never reader-facing.
check_not_contains "does not offer the DOCX master to readers" "$WORKDIR/book.html" "/docx"

# A book is read here or sent to a device; it is never a file to collect.
# No download links exist anywhere on the page, for any part or format.
check_not_contains "offers no download links at all" "$WORKDIR/book.html" "/download/"

# Staged release: part 1 open, later parts held for this reader.
check_contains "first part is readable" "$WORKDIR/book.html" "/read/analects/1"
check_contains "later parts are held back" "$WORKDIR/book.html" "Opens after the previous part"
check_not_contains "held-back part offers no reader link" "$WORKDIR/book.html" "/read/analects/3"

# --- access control is server-side ------------------------------------
echo "access control (anonymous)"
# The download route was removed with the feature. Asserting it is gone
# stops it being quietly reintroduced: it was the one path that handed a
# reader a file, and the rules it enforced now live only in the send and
# read paths.
check_eq "the download route no longer exists" "$(status_of "$BASE_URL/download/2/epub")" 404

# The reader's EPUB stream is now the only way bytes leave storage, so
# it is the path that has to refuse an anonymous request.
STREAM_STATUS="$(status_of "$BASE_URL/read/analects/1/epub")"
case "$STREAM_STATUS" in
    401 | 403 | 302 | 303 | 307) pass "anonymous EPUB stream is refused ($STREAM_STATUS)" ;;
    200) fail "anonymous EPUB stream is refused" "SERVED THE FILE — authorization is missing" ;;
    *) fail "anonymous EPUB stream is refused" "unexpected status $STREAM_STATUS" ;;
esac

for path in /account /read/analects/1; do
    STATUS="$(status_of "$BASE_URL$path")"
    case "$STATUS" in
        401 | 403 | 302 | 303 | 307) pass "anonymous $path is refused ($STATUS)" ;;
        *) fail "anonymous $path is refused" "got $STATUS" ;;
    esac
done

# --- the authenticated reader -----------------------------------------
#
# Payload resolves a session cookie only for requests that look like they
# came from a browser: a bare cookie with no fetch-metadata headers is
# treated as unauthenticated. Real browsers always send these on
# same-origin navigation, so the headers below are what makes this test
# representative rather than a special case.
echo "access control (signed in)"

# These register a reader and record deliveries, so they only run where
# writing is acceptable. See the ALLOW_WRITES note at the top.
if [ "$WRITES_OK" -eq 0 ]; then
    skip "signed-in checks (they write; re-run with ALLOW_WRITES=1 to include them)"
else

    EMAIL="smoke-$(date +%s)-$$@noblesee.test"
    PASSWORD="smoke-test-password"

    REGISTER="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/users" \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
    check_eq "a reader can register" "$REGISTER" 201

    # Registering as an admin must not work, whichever door it comes through.
    ESCALATE="$(curl -s -X POST "$BASE_URL/api/users" -H 'Content-Type: application/json' \
        -d "{\"email\":\"escalate-$(date +%s)-$$@noblesee.test\",\"password\":\"$PASSWORD\",\"roles\":[\"admin\"]}" |
        grep -o '"roles":\[[^]]*\]' | head -1)"
    check_eq "self-granted admin role is refused" "$ESCALATE" '"roles":["reader"]'

    TOKEN="$(curl -s -X POST "$BASE_URL/api/users/login" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" |
        grep -o '"token":"[^"]*"' | cut -d'"' -f4)"

    if [ -z "$TOKEN" ]; then
        fail "a reader can sign in" "no token returned"
    else
        pass "a reader can sign in"

        auth() { # path -> status
            curl -s -o /dev/null -w '%{http_code}' \
                -H "Cookie: payload-token=$TOKEN" \
                -H 'Sec-Fetch-Site: same-origin' \
                -H 'Sec-Fetch-Mode: navigate' \
                -H 'User-Agent: Mozilla/5.0' \
                "$BASE_URL$1"
        }

        check_eq "signed in, the account page opens" "$(auth /account)" 200
        check_eq "signed in, the reader opens" "$(auth /read/analects/1)" 200

        # Reading is the open path: part 1 for anyone signed in, part 3
        # held until part 2 has been started.
        # 200, not a redirect: the artifact is streamed from R2 through the
        # Worker. The R2 binding has no presigned URLs, so there is no
        # third-party URL to be sent to — which is the point, since such a
        # URL would outlive the authorization decision that produced it.
        check_eq "an open part streams to the reader" "$(auth /read/analects/1/epub)" 200
        check_eq "a held-back part is refused" "$(auth /read/analects/3/epub)" 403

        # ...and the bytes are the real file, not an error page.
        BYTES="$(curl -sL -o "$WORKDIR/part.epub" -w '%{size_download}' \
            -H "Cookie: payload-token=$TOKEN" -H 'Sec-Fetch-Site: same-origin' \
            -H 'User-Agent: Mozilla/5.0' "$BASE_URL/read/analects/1/epub")"
        if [ "${BYTES:-0}" -gt 1000 ] && head -c 2 "$WORKDIR/part.epub" | grep -q 'PK'; then
            pass "the reader is served a real EPUB ($BYTES bytes)"
        else
            fail "the reader is served a real EPUB" "got $BYTES bytes"
        fi

        # Reading must never consume a slot. The limit exists to pace
        # bulk *delivery*; charging someone for opening a book in the
        # browser would penalise exactly the behaviour the site is for.
        LEDGER="$(curl -s -H "Cookie: payload-token=$TOKEN" -H 'Sec-Fetch-Site: same-origin' \
            -H 'User-Agent: Mozilla/5.0' "$BASE_URL/api/downloads?limit=50&depth=0")"
        ROWS="$(echo "$LEDGER" | grep -o '"totalDocs":[0-9]*' | cut -d: -f2)"
        if [ "${ROWS:-0}" -eq 0 ]; then
            pass "reading consumes no delivery slots"
        else
            fail "reading consumes no delivery slots" "expected 0 ledger rows, got ${ROWS:-0}"
        fi

        curl -s -H "Cookie: payload-token=$TOKEN" -H 'Sec-Fetch-Site: same-origin' \
            -H 'User-Agent: Mozilla/5.0' "$BASE_URL/account" >"$WORKDIR/account.html"
        check_contains "the full allowance is intact" "$WORKDIR/account.html" "5 of 5"

        # Send-to-Kindle is offered, and the Amazon approved-sender step
        # is shown. Getting that wrong is the one failure a reader cannot
        # diagnose: Amazon discards the document without a bounce.
        check_contains "the account page offers Kindle delivery" \
            "$WORKDIR/account.html" "Send to Kindle"
        check_contains "and names the sender to approve in Amazon" \
            "$WORKDIR/account.html" "kindle@noblesee.com"
    fi
fi

# The admin must never be reachable without authentication.
ADMIN_BODY="$(curl -s "$BASE_URL/admin")"
if echo "$ADMIN_BODY" | grep -qiE 'login|email|password'; then
    pass "admin presents a login rather than the dashboard"
else
    fail "admin presents a login rather than the dashboard" "no login form found"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32m%d passed, 0 failed\033[0m' "$PASS"
else
    printf '\033[31m%d passed, %d failed\033[0m' "$PASS" "$FAIL"
fi
[ "$SKIP" -gt 0 ] && printf '\033[33m, %d skipped\033[0m' "$SKIP"
printf '\n'

# A skip is reported but never fails the run: a read-only pass against
# production is a legitimate way to use this, not a broken one.
if [ "$SKIP" -gt 0 ]; then
    printf 'Skipped the write tests. Re-run with ALLOW_WRITES=1 to include them.\n'
fi
exit $((FAIL > 0))
