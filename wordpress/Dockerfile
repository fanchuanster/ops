# Extends the stock WordPress image with:
#   - WP-CLI, so this container can run one-off plugin commands (e.g. the
#     `wp nr backfill-storage` R2 migration in includes/cli.php) without
#     needing the separate wordpress:cli provisioning image.
#   - The noblesee-core plugin's Composer dependencies (aws/aws-sdk-php,
#     for includes/storage.php's R2 client), installed at build time so
#     container start stays fast and deterministic — not run on every
#     boot.
#
# docker-compose.yml bind-mounts the plugin's PHP/CSS/JS subdirectories
# individually (not the whole plugin directory) specifically so this
# baked-in vendor/ is never shadowed by the live-edit mount. See the
# comment on the wordpress service's `volumes` for why.
FROM wordpress:php8.3-apache

RUN curl -o /usr/local/bin/wp -sSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
    && chmod +x /usr/local/bin/wp

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY plugins/noblesee-core/composer.json plugins/noblesee-core/composer.lock /tmp/noblesee-core/
RUN composer install \
        --no-interaction \
        --no-dev \
        --no-progress \
        --optimize-autoloader \
        --working-dir=/tmp/noblesee-core \
    && mkdir -p /var/www/html/wp-content/plugins/noblesee-core \
    && mv /tmp/noblesee-core/vendor /var/www/html/wp-content/plugins/noblesee-core/vendor \
    && rm -rf /tmp/noblesee-core
