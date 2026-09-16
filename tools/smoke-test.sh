#!/usr/bin/env bash
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

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

check_eq() {
    if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$3', got '$2'"; fi
}

check_contains() {
    if grep -qF -- "$3" "$2"; then pass "$1"; else fail "$1" "missing: $3"; fi
}

check_not_contains() {
    if grep -qF -- "$3" "$2"; then fail "$1" "unexpectedly present: $3"; else pass "$1"; fi
}

status_of() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

echo "NobleSee smoke test — $BASE_URL"
echo

echo "stack"
check_eq "health endpoint reports ok" \
    "$(curl -s "$BASE_URL/health" | tr -d ' ' | grep -o '"status":"ok"' || true)" \
    '"status":"ok"'

echo "pages"
for path in / /books /collections /about /books/analects /books/tao-te-ching; do
    check_eq "GET $path" "$(status_of "$BASE_URL$path")" 200
done
check_eq "unknown book is 404, not 500" "$(status_of "$BASE_URL/books/no-such-book")" 404

curl -s "$BASE_URL/books" >"$WORKDIR/catalog.html"
curl -s "$BASE_URL/books/analects" >"$WORKDIR/book.html"

echo "catalog"
check_contains "catalog lists a seeded book" "$WORKDIR/catalog.html" "The Analects"
check_contains "catalog lists the other seeded book" "$WORKDIR/catalog.html" "Tao Te Ching"
check_contains "collection filter is offered" "$WORKDIR/catalog.html" "collection=chinese-classics"

curl -s "$BASE_URL/books?collection=personal-development" >"$WORKDIR/filtered.html"
check_contains "filter keeps the matching book" "$WORKDIR/filtered.html" "The Analects"
check_not_contains "filter excludes the non-matching book" "$WORKDIR/filtered.html" "Tao Te Ching"

curl -s "$BASE_URL/books?collection=does-not-exist" >"$WORKDIR/bogus.html"
check_not_contains "unknown collection yields nothing, not everything" \
    "$WORKDIR/bogus.html" "The Analects"

echo "book page"
check_contains "shows the original-script title" "$WORKDIR/book.html" "論語"
check_contains "shows the rights status" "$WORKDIR/book.html" "public domain"
check_contains "offers EPUB" "$WORKDIR/book.html" "EPUB"
check_contains "offers the three PDF sizes" "$WORKDIR/book.html" "Extra Large"

check_not_contains "does not offer the DOCX master to readers" "$WORKDIR/book.html" "/docx"

check_not_contains "offers no download links at all" "$WORKDIR/book.html" "/download/"

check_contains "first part is readable" "$WORKDIR/book.html" "/read/analects/1"
check_contains "later parts are held back" "$WORKDIR/book.html" "Opens after the previous part"
check_not_contains "held-back part offers no reader link" "$WORKDIR/book.html" "/read/analects/3"

echo "access control (anonymous)"
check_eq "the download route no longer exists" "$(status_of "$BASE_URL/download/2/epub")" 404

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

echo "access control (signed in)"

if [ "$WRITES_OK" -eq 0 ]; then
    skip "signed-in checks (they write; re-run with ALLOW_WRITES=1 to include them)"
else

    EMAIL="smoke-$(date +%s)-$$@noblesee.test"
    PASSWORD="smoke-test-password"

    REGISTER="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/users" \
        -H 'Content-Type: application/json' \
        -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
    check_eq "a reader can register" "$REGISTER" 201

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

        auth() {
            curl -s -o /dev/null -w '%{http_code}' \
                -H "Cookie: payload-token=$TOKEN" \
                -H 'Sec-Fetch-Site: same-origin' \
                -H 'Sec-Fetch-Mode: navigate' \
                -H 'User-Agent: Mozilla/5.0' \
                "$BASE_URL$1"
        }

        check_eq "signed in, the account page opens" "$(auth /account)" 200
        check_eq "signed in, the reader opens" "$(auth /read/analects/1)" 200

        check_eq "an open part streams to the reader" "$(auth /read/analects/1/epub)" 200
        check_eq "a held-back part is refused" "$(auth /read/analects/3/epub)" 403

        BYTES="$(curl -sL -o "$WORKDIR/part.epub" -w '%{size_download}' \
            -H "Cookie: payload-token=$TOKEN" -H 'Sec-Fetch-Site: same-origin' \
            -H 'User-Agent: Mozilla/5.0' "$BASE_URL/read/analects/1/epub")"
        if [ "${BYTES:-0}" -gt 1000 ] && head -c 2 "$WORKDIR/part.epub" | grep -q 'PK'; then
            pass "the reader is served a real EPUB ($BYTES bytes)"
        else
            fail "the reader is served a real EPUB" "got $BYTES bytes"
        fi

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

        check_contains "the account page offers Kindle delivery" \
            "$WORKDIR/account.html" "Send to Kindle"
        check_contains "and names the sender to approve in Amazon" \
            "$WORKDIR/account.html" "kindle@noblesee.com"
    fi
fi

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

if [ "$SKIP" -gt 0 ]; then
    printf 'Skipped the write tests. Re-run with ALLOW_WRITES=1 to include them.\n'
fi
exit $((FAIL > 0))
