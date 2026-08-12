#!/usr/bin/env bash
#
# End-to-end smoke test for the NobleSee core reader flow.
#
#   ./tools/smoke-test.sh                       # against http://localhost:8090
#   BASE_URL=http://10.0.0.5:8090 ./tools/smoke-test.sh
#
# Covers the paths that actually protect content and readers: rights
# gating, the format allowlist (the DOCX master must never be public),
# authentication, nonce validity, staged-release locking, and the
# distinct-book download limit.
#
# DEVELOPMENT ONLY. This mutates site state — it creates a subscriber
# account, clears that account's download history, and temporarily
# changes the download limit. It restores the limit on exit and only ever
# touches its own test user's rows. Do not point it at production.
#
# Exit code is 0 when every check passes, 1 otherwise.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8090}"
BASE_URL="${BASE_URL%/}"
TEST_USER="noblesee_smoke"
TEST_PASS="smoke-test-$$-pass"
WORKDIR="$(mktemp -d)"
COOKIES="$WORKDIR/cookies.txt"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASSED=0
FAILED=0

if [ -t 1 ]; then
    C_PASS=$'\033[32m'; C_FAIL=$'\033[31m'; C_HEAD=$'\033[1m'; C_OFF=$'\033[0m'
else
    C_PASS=""; C_FAIL=""; C_HEAD=""; C_OFF=""
fi

cleanup() {
    wp_batch "
        wp option update nr_download_limit_per_day ${ORIGINAL_LIMIT:-5} >/dev/null
        USER_ID=\$(wp user get $TEST_USER --field=ID 2>/dev/null)
        [ -n \"\$USER_ID\" ] && wp db query \"DELETE FROM \$(wp db prefix --allow-root 2>/dev/null || echo wp_)nr_downloads WHERE user_id = \$USER_ID;\"
    " >/dev/null 2>&1
    rm -rf "$WORKDIR"
}
trap cleanup EXIT

section() { printf "\n%s%s%s\n" "$C_HEAD" "$1" "$C_OFF"; }
pass()    { printf "  %sPASS%s  %s\n" "$C_PASS" "$C_OFF" "$1"; PASSED=$((PASSED + 1)); }
fail()    { printf "  %sFAIL%s  %s\n" "$C_FAIL" "$C_OFF" "$1"; FAILED=$((FAILED + 1)); }

check_eq() { # description, actual, expected
    if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 — expected '$3', got '$2'"; fi
}

check_contains() { # description, haystack-file, needle
    if grep -qF -- "$3" "$2"; then pass "$1"; else fail "$1 — '$3' not found"; fi
}

check_not_contains() { # description, haystack-file, needle
    if grep -qF -- "$3" "$2"; then fail "$1 — '$3' unexpectedly present"; else pass "$1"; fi
}

# Run wp-cli commands inside the provisioning container. Batched because
# each invocation spins up a container, which is slow.
wp_batch() {
    docker compose run --rm --entrypoint sh provision -c "
        set -e
        wp() { command wp --path=/var/www/html --allow-root \"\$@\"; }
        $1
    " 2>/dev/null | tr -d '\r'
}

status_of() { # url
    curl -s -o /dev/null -w '%{http_code}' -b "$COOKIES" -c "$COOKIES" "$1"
}

# Pull a nonce-signed download URL for a part+format out of a fetched page.
download_url() { # page-file, part-id, format
    grep -oE "href=\"[^\"]*noblesee-download/$2/$3/?[^\"]*\"" "$1" \
        | head -1 | sed 's/href="//; s/"$//; s/&#038;/\&/g'
}

# --------------------------------------------------------------------------
printf "%sNobleSee smoke test%s  →  %s\n" "$C_HEAD" "$C_OFF" "$BASE_URL"

if ! curl -sf -o /dev/null "$BASE_URL/"; then
    printf "\n%sSite is not reachable at %s%s\n" "$C_FAIL" "$BASE_URL" "$C_OFF"
    printf "Start it with: docker compose up -d\n"
    exit 1
fi

section "Setup"
SETUP=$(wp_batch "
    wp user get $TEST_USER --field=ID >/dev/null 2>&1 \
        || wp user create $TEST_USER ${TEST_USER}@example.invalid --role=subscriber --porcelain >/dev/null
    wp user update $TEST_USER --user_pass='$TEST_PASS' >/dev/null
    echo \"USER_ID=\$(wp user get $TEST_USER --field=ID)\"
    echo \"LIMIT=\$(wp option get nr_download_limit_per_day)\"
    echo \"TTC=\$(wp post list --post_type=nr_book --name=tao-te-ching --field=ID)\"
    echo \"ANALECTS=\$(wp post list --post_type=nr_book --name=analects --field=ID)\"
")
eval "$(echo "$SETUP" | grep -E '^(USER_ID|LIMIT|TTC|ANALECTS)=')"
ORIGINAL_LIMIT="${LIMIT:-5}"

if [ -z "${USER_ID:-}" ] || [ -z "${ANALECTS:-}" ]; then
    fail "could not prepare test fixtures (user or seed books missing)"
    printf "\n%s\n" "$SETUP"
    exit 1
fi

ANALECTS_PARTS=$(wp_batch "wp post list --post_type=nr_part --post_parent=$ANALECTS --orderby=menu_order --order=ASC --field=ID")
PART1=$(echo "$ANALECTS_PARTS" | sed -n '1p')
PART2=$(echo "$ANALECTS_PARTS" | sed -n '2p')
pass "fixtures ready (user #$USER_ID, book #$ANALECTS, parts $PART1/$PART2)"

section "Public pages"
check_eq "home responds"                "$(status_of "$BASE_URL/")"                200
check_eq "catalog responds"             "$(status_of "$BASE_URL/books/")"          200
check_eq "single book responds"         "$(status_of "$BASE_URL/books/analects/")" 200

curl -s "$BASE_URL/" -o "$WORKDIR/home.html"
check_not_contains "home has no WordPress boilerplate" "$WORKDIR/home.html" "Hello world!"
check_contains     "home shows the library"            "$WORKDIR/home.html" "nr-book-grid"

curl -s "$BASE_URL/books/" -o "$WORKDIR/catalog.html"
check_contains "catalog lists a seeded book" "$WORKDIR/catalog.html" "The Analects"

section "Downloads require authentication"
check_eq "anonymous download redirects to login" \
    "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/noblesee-download/$PART1/epub/")" 302

section "Login"
curl -s -c "$COOKIES" -b "$COOKIES" \
    --data-urlencode "log=$TEST_USER" --data-urlencode "pwd=$TEST_PASS" \
    -d "testcookie=1" "$BASE_URL/wp-login.php" -o /dev/null
if grep -q "wordpress_logged_in" "$COOKIES"; then
    pass "logged in as $TEST_USER"
else
    fail "could not log in as $TEST_USER — remaining checks are unreliable"
fi

# Clean slate: this user's history only.
wp_batch "wp db query \"DELETE FROM \$(wp db prefix)nr_downloads WHERE user_id = $USER_ID;\"
          wp option update nr_download_limit_per_day 5 >/dev/null" >/dev/null

section "Format allowlist and link integrity"
curl -s -b "$COOKIES" -c "$COOKIES" "$BASE_URL/books/analects/" -o "$WORKDIR/book.html"
EPUB_URL=$(download_url "$WORKDIR/book.html" "$PART1" epub)

if [ -z "$EPUB_URL" ]; then
    fail "no download link rendered for part $PART1"
else
    pass "download links rendered with nonce"
    check_eq "EPUB downloads"      "$(status_of "$EPUB_URL")" 200
    check_eq "DOCX master blocked" "$(status_of "${EPUB_URL/\/epub\//\/docx\/}")" 404
    check_eq "unknown format blocked" "$(status_of "${EPUB_URL/\/epub\//\/mobi\/}")" 404
    check_eq "tampered nonce rejected" \
        "$(status_of "$BASE_URL/noblesee-download/$PART1/epub/?_wpnonce=deadbeef")" 403
fi

section "Download limit counts distinct books, not files"
wp_batch "wp db query \"DELETE FROM \$(wp db prefix)nr_downloads WHERE user_id = $USER_ID;\"" >/dev/null
for FMT in epub pdf_standard pdf_large pdf_xl; do
    URL=$(download_url "$WORKDIR/book.html" "$PART1" "$FMT")
    [ -n "$URL" ] && status_of "$URL" >/dev/null
done
COUNTS=$(wp_batch "wp db query \"SELECT COUNT(*), COUNT(DISTINCT book_id) FROM \$(wp db prefix)nr_downloads WHERE user_id=$USER_ID;\" --skip-column-names")
check_eq "four formats logged individually" "$(echo "$COUNTS" | awk '{print $1}')" 4
check_eq "but count as one book"            "$(echo "$COUNTS" | awk '{print $2}')" 1

if [ -n "${TTC:-}" ]; then
    wp_batch "wp db query \"DELETE FROM \$(wp db prefix)nr_downloads WHERE user_id = $USER_ID;\"
              wp option update nr_download_limit_per_day 1 >/dev/null" >/dev/null
    URL=$(download_url "$WORKDIR/book.html" "$PART1" epub)
    status_of "$URL" >/dev/null
    curl -s -b "$COOKIES" -c "$COOKIES" "$BASE_URL/books/tao-te-ching/" -o "$WORKDIR/ttc.html"
    TTC_PART=$(grep -oE 'noblesee-download/[0-9]+/epub' "$WORKDIR/ttc.html" | head -1 | cut -d/ -f2)
    TTC_URL=$(download_url "$WORKDIR/ttc.html" "$TTC_PART" epub)
    check_eq "second distinct book blocked at limit" "$(status_of "$TTC_URL")" 429
    wp_batch "wp option update nr_download_limit_per_day 5 >/dev/null" >/dev/null
fi

section "Staged release"
if [ -z "$PART2" ]; then
    fail "no multi-part book available to test staged release"
else
    reset_history() {
        wp_batch "wp db query \"DELETE FROM \$(wp db prefix)nr_downloads WHERE user_id = $USER_ID;\"" >/dev/null
    }
    logged_rows() {
        wp_batch "wp db query \"SELECT COUNT(*) FROM \$(wp db prefix)nr_downloads WHERE user_id=$USER_ID;\" --skip-column-names"
    }

    # Start the clock, then age it past the delay so the later part opens.
    reset_history
    status_of "$(download_url "$WORKDIR/book.html" "$PART1" epub)" >/dev/null
    curl -s -b "$COOKIES" -c "$COOKIES" "$BASE_URL/books/analects/" -o "$WORKDIR/waiting.html"
    check_contains "next part shows a wait while the delay runs" "$WORKDIR/waiting.html" "nr-part-lock"
    if [ -n "$(download_url "$WORKDIR/waiting.html" "$PART2" epub)" ]; then
        fail "waiting part offered a download link"
    else
        pass "waiting part offers no download link"
    fi

    wp_batch "wp db query \"UPDATE \$(wp db prefix)nr_downloads SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) WHERE user_id=$USER_ID AND part_id=$PART1;\"" >/dev/null
    curl -s -b "$COOKIES" -c "$COOKIES" "$BASE_URL/books/analects/" -o "$WORKDIR/open.html"
    P2_URL=$(download_url "$WORKDIR/open.html" "$PART2" epub)
    if [ -n "$P2_URL" ]; then
        check_eq "later part opens once the delay has passed" "$(status_of "$P2_URL")" 200
    else
        fail "later part still locked after the delay elapsed"
        P2_URL=""
    fi

    # Re-lock by erasing the history that opened it. $P2_URL keeps a valid
    # nonce, so this exercises the server-side gate itself rather than
    # bouncing off nonce validation — which would pass even with staged
    # release switched off.
    if [ -n "$P2_URL" ]; then
        reset_history
        BODY="$WORKDIR/locked-body.html"
        CODE=$(curl -s -o "$BODY" -w '%{http_code}' -b "$COOKIES" -c "$COOKIES" "$P2_URL")
        check_eq "locked part refused with a valid nonce" "$CODE" 403
        check_contains "refusal explains the staged release, not a bad link" \
            "$BODY" "Opens once you begin"
        check_eq "a locked attempt consumes no download slot" "$(logged_rows)" 0
    fi
fi

section "Result"
printf "  %d passed, %d failed\n\n" "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
