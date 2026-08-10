<?php
/**
 * The download route: /nobleread-download/{part_id}/{format}/
 *
 * Order of checks (each fails closed): route match -> known format
 * (docx is never in the allowlist — the DOCX master stays private, it is
 * the source of truth, never the redistributed artifact) -> logged in ->
 * valid nonce -> book rights status allows public download -> under the
 * per-user rate limit -> file actually exists. Only then is the file
 * streamed, and only then is a download recorded.
 *
 * Streamed via readfile(), not a redirect to the media URL, so the real
 * storage path is never exposed/bookmarkable — keeps this endpoint's
 * contract stable once storage moves to S3 presigned URLs (see
 * docs/ROADMAP.md).
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', 'nr_add_download_rewrite');
add_filter('query_vars', 'nr_add_query_vars');
add_action('template_redirect', 'nr_handle_download_request');

function nr_add_download_rewrite() {
    add_rewrite_rule(
        '^nobleread-download/([0-9]+)/([a-z_]+)/?$',
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
 * Public download formats. Intentionally excludes 'docx' — see file
 * docblock and CLAUDE.md section 5 ("The DOCX master is the source of
 * truth... Do NOT use PDF [or anything else] as the canonical source").
 */
function nr_download_format_map() {
    return [
        'epub' => [
            'meta' => 'nr_epub_attachment_id',
            'disposition' => 'attachment',
            'label' => __('EPUB', 'nobleread-core'),
        ],
        'pdf_standard' => [
            'meta' => 'nr_pdf_standard_attachment_id',
            'disposition' => 'inline',
            'label' => __('PDF — Standard', 'nobleread-core'),
        ],
        'pdf_large' => [
            'meta' => 'nr_pdf_large_attachment_id',
            'disposition' => 'inline',
            'label' => __('PDF — Large', 'nobleread-core'),
        ],
        'pdf_xl' => [
            'meta' => 'nr_pdf_xl_attachment_id',
            'disposition' => 'inline',
            'label' => __('PDF — Extra Large', 'nobleread-core'),
        ],
    ];
}

function nr_handle_download_request() {
    $part_id = absint(get_query_var('nr_download_part'));
    if (!$part_id) {
        return; // Not our route.
    }
    $format = sanitize_key(get_query_var('nr_download_format'));

    $part = get_post($part_id);
    if (!$part || 'nr_part' !== $part->post_type || 'publish' !== $part->post_status) {
        nr_download_die(__('This part could not be found.', 'nobleread-core'), 404);
    }

    $formats = nr_download_format_map();
    if (!isset($formats[$format])) {
        nr_download_die(__('That format is not available for download.', 'nobleread-core'), 404);
    }

    if (!is_user_logged_in()) {
        auth_redirect();
        exit;
    }

    $nonce = isset($_GET['_wpnonce']) ? sanitize_text_field(wp_unslash($_GET['_wpnonce'])) : '';
    if (!wp_verify_nonce($nonce, 'nr_download_' . $part_id)) {
        nr_download_die(__('This download link has expired. Please go back to the book page and try again.', 'nobleread-core'), 403);
    }

    $book_id = (int) $part->post_parent;
    $rights = get_post_meta($book_id, 'nr_rights_status', true);
    if (!in_array($rights, nr_downloadable_rights_statuses(), true)) {
        nr_download_die(__("This title isn't available for direct download yet.", 'nobleread-core'), 403);
    }

    $user_id = get_current_user_id();
    if (!NR_Download_Limiter::under_limit($user_id, $book_id)) {
        nr_download_die(
            sprintf(
                /* translators: %d: books-per-day limit */
                __("You've reached today's limit of %d books. Anything you've already started today is still free to download in any format — and there's more waiting tomorrow. Thanks for reading so much!", 'nobleread-core'),
                NR_Download_Limiter::limit_per_day()
            ),
            429
        );
    }

    $attachment_id = (int) get_post_meta($part_id, $formats[$format]['meta'], true);
    $file = $attachment_id ? get_attached_file($attachment_id) : false;
    if (!$file || !file_exists($file)) {
        nr_download_die(__('This format is not ready yet. Please check back soon.', 'nobleread-core'), 404);
    }

    NR_Download_Limiter::record($user_id, $part_id, $book_id, $format);

    nr_stream_file($file, $formats[$format]['disposition']);
    exit;
}

function nr_download_die($message, $status) {
    status_header($status);
    wp_die(
        esc_html($message),
        esc_html__('NobleRead', 'nobleread-core'),
        ['response' => $status, 'back_link' => true]
    );
}

function nr_stream_file($file, $disposition) {
    $mime = wp_check_filetype($file);
    $content_type = $mime['type'] ?: 'application/octet-stream';

    nocache_headers();
    header('Content-Type: ' . $content_type);
    header('Content-Disposition: ' . $disposition . '; filename="' . basename($file) . '"');
    header('Content-Length: ' . filesize($file));
    header('X-Content-Type-Options: nosniff');

    readfile($file);
}
