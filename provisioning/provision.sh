#!/usr/bin/env bash
# Idempotent site bootstrap, run once by the `provision` service in
# docker-compose.yml. Safe to re-run: `docker compose up` never
# duplicates the install, theme/plugin activation, or seed content.
set -euo pipefail

WP="wp --path=/var/www/html --allow-root"

echo "== NobleSee provisioning =="

# On a fresh wp_data volume the wordpress service is still unpacking core
# into it when compose reports the container "started", so every wp call
# below would fail with "This does not seem to be a WordPress
# installation". depends_on can't express "core is extracted", so wait for
# the file wp-settings.php, which the image writes last-ish and which
# every wp subcommand needs.
echo "-- Waiting for WordPress core files"
until [ -f /var/www/html/wp-settings.php ]; do
    echo "   core not extracted yet, retrying in 3s..."
    sleep 3
done
echo "   core files are present"

if ! $WP config path >/dev/null 2>&1; then
    echo "-- Creating wp-config.php"
    $WP config create \
        --dbname="${WORDPRESS_DB_NAME:-wordpress}" \
        --dbuser="${WORDPRESS_DB_USER:-wordpress}" \
        --dbpass="${WORDPRESS_DB_PASSWORD:-wordpress}" \
        --dbhost="${WORDPRESS_DB_HOST:-db}" \
        --skip-check
fi

echo "-- Waiting for database"
until $WP db check >/dev/null 2>&1; do
    echo "   database not ready, retrying in 3s..."
    sleep 3
done
echo "   database is ready"

if ! $WP core is-installed >/dev/null 2>&1; then
    echo "-- Installing WordPress core"
    $WP core install \
        --url="${WORDPRESS_URL:-http://localhost:8080}" \
        --title="${WORDPRESS_TITLE:-NobleSee}" \
        --admin_user="${WORDPRESS_ADMIN_USER:-admin}" \
        --admin_password="${WORDPRESS_ADMIN_PASSWORD:-admin}" \
        --admin_email="${WORDPRESS_ADMIN_EMAIL:-admin@noblesee.com}" \
        --skip-email
else
    echo "-- WordPress core already installed"
fi

echo "-- Setting permalinks (needed for /books/ and the download route)"
$WP rewrite structure '/%postname%/' --hard
$WP rewrite flush --hard

echo "-- Enabling self-service registration (Subscriber role)"
$WP option update users_can_register 1
$WP option update default_role subscriber

echo "-- Installing/activating theme: Kadence"
if ! $WP theme is-installed kadence >/dev/null 2>&1; then
    $WP theme install kadence
fi
$WP theme activate kadence

echo "-- Activating plugin: noblesee-core"
$WP plugin activate noblesee-core

echo "-- Applying NobleSee settings"
$WP option update nr_download_limit_per_day "${NR_DOWNLOAD_LIMIT_PER_DAY:-5}"

echo "-- Setting up catalog structure"
$WP eval-file /provisioning/setup-catalogs.php

echo "-- Seeding sample content"
$WP eval-file /provisioning/seed-import.php

echo "-- Configuring front page, nav menu, and removing WP sample content"
$WP eval-file /provisioning/setup-site.php

echo "== Provisioning complete =="
