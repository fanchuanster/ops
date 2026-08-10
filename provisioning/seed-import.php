<?php
/**
 * Seed content importer, run via `wp eval-file` (full WP bootstrap
 * available). Creates one real Book + Part — Tao Te Ching, Chapter 1,
 * James Legge's 1891 public-domain translation — with all reader formats
 * attached, to prove the catalog -> book -> download flow end-to-end.
 *
 * Idempotent: if a Book with slug 'tao-te-ching' already exists, this
 * exits without making changes, so re-running `docker compose up` never
 * duplicates content.
 */

if (!defined('ABSPATH')) {
    exit;
}

$existing = get_posts([
    'post_type' => 'nr_book',
    'name' => 'tao-te-ching',
    'post_status' => 'any',
    'numberposts' => 1,
]);

if (!empty($existing)) {
    WP_CLI::log('Seed book already exists (post ID ' . $existing[0]->ID . ') — skipping.');
    return;
}

$seed_dir = WP_PLUGIN_DIR . '/nobleread-core/seed-content/tao-te-ching-ch1/';

/**
 * Import a local file into the media library and return its attachment
 * ID, or 0 if the source file is missing.
 */
function nr_seed_import_file($path) {
    if (!file_exists($path)) {
        WP_CLI::warning("Seed file missing: {$path}");
        return 0;
    }

    $filename = basename($path);
    $contents = file_get_contents($path);
    $upload = wp_upload_bits($filename, null, $contents);
    if (!empty($upload['error'])) {
        WP_CLI::warning('Upload failed for ' . $filename . ': ' . $upload['error']);
        return 0;
    }

    $filetype = wp_check_filetype($filename, null);
    $attachment_id = wp_insert_attachment(
        [
            'post_mime_type' => $filetype['type'],
            'post_title' => sanitize_file_name($filename),
            'post_content' => '',
            'post_status' => 'inherit',
        ],
        $upload['file']
    );

    require_once ABSPATH . 'wp-admin/includes/image.php';
    $metadata = wp_generate_attachment_metadata($attachment_id, $upload['file']);
    wp_update_attachment_metadata($attachment_id, $metadata);

    return $attachment_id;
}

WP_CLI::log('Creating seed Book: Tao Te Ching');

$book_id = wp_insert_post([
    'post_type' => 'nr_book',
    'post_title' => 'Tao Te Ching (道德经)',
    'post_name' => 'tao-te-ching',
    'post_status' => 'publish',
    'post_content' => "One of the foundational texts of Chinese philosophy, traditionally attributed to Laozi. This edition presents James Legge's 1891 translation (public domain) alongside the original Chinese text.\n\nThis is a NobleRead seed title, included to demonstrate the full catalog -> book -> download flow.",
], true);

if (is_wp_error($book_id)) {
    WP_CLI::error('Failed to create seed book: ' . $book_id->get_error_message());
}

update_post_meta($book_id, 'nr_author', 'Laozi (老子)');
update_post_meta($book_id, 'nr_translator', 'James Legge (1891)');
update_post_meta($book_id, 'nr_language', 'Chinese / English');
update_post_meta($book_id, 'nr_rights_status', 'public_domain');

$cover_id = nr_seed_import_file($seed_dir . 'cover.jpg');
if ($cover_id) {
    set_post_thumbnail($book_id, $cover_id);
}

$docx_id = nr_seed_import_file($seed_dir . 'master.docx');
$epub_id = nr_seed_import_file($seed_dir . 'part-1.epub');
$pdf_standard_id = nr_seed_import_file($seed_dir . 'part-1-pdf-standard.pdf');
$pdf_large_id = nr_seed_import_file($seed_dir . 'part-1-pdf-large.pdf');
$pdf_xl_id = nr_seed_import_file($seed_dir . 'part-1-pdf-xl.pdf');

WP_CLI::log('Creating seed Part: Chapter 1');

$part_id = wp_insert_post([
    'post_type' => 'nr_part',
    'post_title' => 'Chapter 1 / 第一章',
    'post_status' => 'publish',
    'post_parent' => $book_id,
    'menu_order' => 1,
], true);

if (is_wp_error($part_id)) {
    WP_CLI::error('Failed to create seed part: ' . $part_id->get_error_message());
}

update_post_meta($part_id, 'nr_docx_attachment_id', $docx_id);
update_post_meta($part_id, 'nr_epub_attachment_id', $epub_id);
update_post_meta($part_id, 'nr_pdf_standard_attachment_id', $pdf_standard_id);
update_post_meta($part_id, 'nr_pdf_large_attachment_id', $pdf_large_id);
update_post_meta($part_id, 'nr_pdf_xl_attachment_id', $pdf_xl_id);

update_post_meta($book_id, '_nr_seed_version', '1');

WP_CLI::success("Seeded Book #{$book_id} with Part #{$part_id}.");
