#!/bin/sh
# Wait for PostgreSQL, apply migrations, then hand off to the CMD.
#
# The wait is not belt-and-braces: compose reports a container "started"
# well before Postgres accepts connections, and the WordPress stack hit
# exactly this race on a fresh volume (see provisioning/provision.sh).
set -eu

echo "-- Waiting for PostgreSQL at ${POSTGRES_HOST:-webdb}:${POSTGRES_PORT:-5432}"
until python -c "
import os, sys
import psycopg
try:
    psycopg.connect(
        host=os.environ.get('POSTGRES_HOST', 'webdb'),
        port=os.environ.get('POSTGRES_PORT', '5432'),
        dbname=os.environ.get('POSTGRES_DB', 'noblesee'),
        user=os.environ.get('POSTGRES_USER', 'noblesee'),
        password=os.environ.get('POSTGRES_PASSWORD', 'noblesee'),
        connect_timeout=3,
    ).close()
except Exception:
    sys.exit(1)
" 2>/dev/null; do
    echo "   not ready, retrying in 2s..."
    sleep 2
done
echo "   PostgreSQL is ready"

echo "-- Applying migrations"
python manage.py migrate --noinput

exec "$@"
