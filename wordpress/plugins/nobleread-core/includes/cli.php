<?php
/**
 * `wp nr backfill-storage` — pushes already-attached part files (DOCX/
 * EPUB/PDF, per nr_part_format_fields()) to R2 for every existing Part,
 * via the same nr_storage_sync_to_r2() that normally runs on save
 * (includes/meta-boxes.php). One-time catch-up for content that was
 * attached before R2 was configured — new saves sync automatically.
 *
 * Manual, not part of first-boot provisioning: it needs real R2
 * credentials, which aren't assumed to exist in every dev environment
 * (see includes/storage.php). Run inside the wordpress container, which
 * has both WP-CLI and the plugin's Composer deps baked in:
 *
 *   docker compose exec wordpress wp --path=/var/www/html --allow-root nr backfill-storage
 */

if (!defined('ABSPATH') || !defined('WP_CLI')) {
    return;
}

WP_CLI::add_command('nr backfill-storage', function () {
    if (!nr_storage_r2_configured()) {
        WP_CLI::error('R2 is not configured (CLOUDFLARE_S3_* environment variables are unset) — nothing to do.');
    }

    $parts = get_posts([
        'post_type' => 'nr_part',
        'post_status' => 'any',
        'posts_per_page' => -1,
    ]);

    $uploaded = 0;
    $skipped = 0;

    foreach ($parts as $part) {
        foreach (nr_part_format_fields() as $meta_key => $label) {
            if (!nr_storage_sync_to_r2($part->ID, $meta_key)) {
                $skipped++;
                continue;
            }
            $uploaded++;
            WP_CLI::log(sprintf(
                '  %s — %s -> %s',
                $part->post_title,
                $label,
                get_post_meta($part->ID, nr_storage_r2_key_meta($meta_key), true)
            ));
        }
    }

    WP_CLI::success(sprintf(
        'R2 backfill done: %d file(s) uploaded, %d field(s) skipped (no file attached).',
        $uploaded,
        $skipped
    ));
});
