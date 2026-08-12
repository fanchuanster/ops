<?php
/**
 * The download route: /noblesee-download/{part_id}/{format}/
 *
 * Access checks live in includes/access.php and are shared with the
 * online reader, so the two can't drift apart. This file only decides
 * which formats are downloadable and streams the bytes.
 *
 * Streamed via readfile(), not a redirect to the media URL, so the real
 * storage location is never exposed or bookmarkable — this held the
 * public download contract stable across the move to R2 storage (see
 * includes/storage.php and docs/ARCHITECTURE_REVIEW.md section 4):
 * files now backed by R2 stream through exactly the same way as local
 * files, via nr_part_file_path()/nr_stream_file() in includes/access.php.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', 'nr_add_download_rewrite');
add_filter('query_vars', 'nr_add_query_vars');
add_action('template_redirect', 'nr_handle_download_request');

function nr_add_download_rewrite() {
    add_rewrite_rule(
        '^noblesee-download/([0-9]+)/([a-z_]+)/?$',
        'index.php?nr_download_part=$matches[1]&nr_download_format=$matches[2]',
        'top'
    );
}

function nr_add_query_vars($vars) {
    $vars[] = 'nr_download_part';
    $vars[] = 'nr_download_format';
    return $vars;
}

/**
 * Public download formats. Intentionally excludes 'docx' — the DOCX
 * master is the source of truth, not a redistributed artifact
 * (CLAUDE.md section 5). Excluding it here rather than relying on admin
 * discipline means an editor attaching a master can never expose it.
 */
function nr_download_format_map() {
    return [
        'epub' => [
            'meta' => 'nr_epub_attachment_id',
            'disposition' => 'attachment',
            'label' => __('EPUB', 'noblesee-core'),
        ],
        'pdf_standard' => [
            'meta' => 'nr_pdf_standard_attachment_id',
            'disposition' => 'inline',
            'label' => __('PDF — Standard', 'noblesee-core'),
        ],
        'pdf_large' => [
            'meta' => 'nr_pdf_large_attachment_id',
            'disposition' => 'inline',
            'label' => __('PDF — Large', 'noblesee-core'),
        ],
        'pdf_xl' => [
            'meta' => 'nr_pdf_xl_attachment_id',
            'disposition' => 'inline',
            'label' => __('PDF — Extra Large', 'noblesee-core'),
        ],
    ];
}

function nr_handle_download_request() {
    $part_id = absint(get_query_var('nr_download_part'));
    if (!$part_id) {
        return; // Not our route.
    }

    $format = sanitize_key(get_query_var('nr_download_format'));
    $formats = nr_download_format_map();
    if (!isset($formats[$format])) {
        nr_access_die(__('That format is not available for download.', 'noblesee-core'), 404);
    }

    $access = nr_guard_part_access($part_id, 'nr_download_');

    $file = nr_part_file_path($part_id, $formats[$format]['meta']);
    if (!$file) {
        nr_access_die(__('This format is not ready yet. Please check back soon.', 'noblesee-core'), 404);
    }

    NR_Download_Limiter::record($access['user_id'], $part_id, $access['book_id'], $format);

    nr_stream_file($file, $formats[$format]['disposition']);
    exit;
}
