#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker build -q -t kj . >/dev/null
tty_flag=""
[ -t 0 ] && tty_flag="-it"
exec docker run --rm $tty_flag ${KJ_CONTAINER:+--name "$KJ_CONTAINER"} --env-file .env -v kj-data:/data kj "$@"
