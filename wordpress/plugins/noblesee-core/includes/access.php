<?php
/**
 * The single access gate for part content.
 *
 * Downloading a part and reading it online are the same act of access, so
 * they must be gated identically — otherwise the online reader becomes a
 * way around rights checks, staged release, or the daily limit. Both
 * entry points call nr_guard_part_access(); the checks live here once.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verify the current visitor may access this part, or stop the request.
 *
 * Checks, in order, each failing closed: part exists and is published ->
 * signed in -> valid nonce -> the book's rights permit distribution ->
 * staged release has opened this part -> the reader is under their daily
 * book limit.
 *
 * @param int    $part_id
 * @param string $nonce_action_prefix e.g. 'nr_download_' or 'nr_read_'
 * @return array{part: WP_Post, book_id: int, user_id: int}
 */
function nr_guard_part_access($part_id, $nonce_action_prefix) {
    $part = get_post($part_id);
    if (!$part || 'nr_part' !== $part->post_type || 'publish' !== $part->post_status) {
        nr_access_die(__('This part could not be found.', 'noblesee-core'), 404);
    }

    if (!is_user_logged_in()) {
        auth_redirect();
        exit;
    }

    $nonce = isset($_GET['_wpnonce']) ? sanitize_text_field(wp_unslash($_GET['_wpnonce'])) : '';
    if (!wp_verify_nonce($nonce, $nonce_action_prefix . $part_id)) {
        nr_access_die(__('This link has expired. Please go back to the book page and try again.', 'noblesee-core'), 403);
    }

    $book_id = (int) $part->post_parent;
    if (!in_array(nr_effective_rights_status($part_id), nr_downloadable_rights_statuses(), true)) {
        nr_access_die(__("This title isn't available to read or download yet.", 'noblesee-core'), 403);
    }

    $user_id = get_current_user_id();

    // Before the limit check on purpose: a part the reader may not open
    // yet must never consume one of their daily book slots.
    $staged = NR_Staged_Release::status($part_id, $user_id);
    if (!$staged['unlocked']) {
        nr_access_die(NR_Staged_Release::lock_message($staged), 403);
    }

    if (!NR_Download_Limiter::under_limit($user_id, $book_id)) {
        nr_access_die(
            sprintf(
                /* translators: %d: books-per-day limit */
                __("You've reached today's limit of %d books. Anything you've already started today is still free to read and download in any format — and there's more waiting tomorrow. Thanks for reading so much!", 'noblesee-core'),
                NR_Download_Limiter::limit_per_day()
            ),
            429
        );
    }

    return ['part' => $part, 'book_id' => $book_id, 'user_id' => $user_id];
}

function nr_access_die($message, $status) {
    status_header($status);
    wp_die(
        esc_html($message),
        esc_html__('NobleSee', 'noblesee-core'),
        ['response' => $status, 'back_link' => true]
    );
}

/**
 * Streams a local path or an R2 "s3://bucket/key" URI (see
 * includes/storage.php) identically — readfile() and friends work
 * against either once the R2 client has registered its stream wrapper,
 * which nr_storage_resolve() guarantees happens before it ever returns
 * an s3:// URI. Never redirects to a public media URL, so the real
 * storage location (local path or R2 key) is never exposed or
 * bookmarkable, on either backend.
 */
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

/**
 * A part's file for a given format: a local absolute path or an R2
 * "s3://..." stream URI (see includes/storage.php), or false if neither
 * has it. nr_stream_file() above reads either transparently.
 */
function nr_part_file_path($part_id, $meta_key) {
    return nr_storage_resolve($part_id, $meta_key);
}
