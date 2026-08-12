<?php
/**
 * In-browser reading.
 *
 *   /noblesee-read/{part_id}/          the reader itself
 *   /noblesee-read-content/{part_id}/  the EPUB bytes it loads
 *
 * CLAUDE.md's core mission asks for reflowable text, adjustable type,
 * chapter navigation and light/dark reading — things a PDF can't give and
 * a downloaded EPUB only gives once the reader already owns an app. This
 * makes that experience available in the browser.
 *
 * Both routes run the same gate as downloading (includes/access.php), so
 * reading online can't sidestep rights, staged release, or the daily
 * limit. The bytes route is split from the page so opening the reader
 * doesn't require re-checking anything mid-render, and so the EPUB URL
 * stays a plain resource epub.js can fetch.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', 'nr_add_reader_rewrites');
add_filter('query_vars', 'nr_add_reader_query_vars');
add_action('template_redirect', 'nr_handle_reader_request');

function nr_add_reader_rewrites() {
    add_rewrite_rule('^noblesee-read/([0-9]+)/?$', 'index.php?nr_read_part=$matches[1]', 'top');
    add_rewrite_rule('^noblesee-read-content/([0-9]+)/?$', 'index.php?nr_read_content_part=$matches[1]', 'top');
}

function nr_add_reader_query_vars($vars) {
    $vars[] = 'nr_read_part';
    $vars[] = 'nr_read_content_part';
    return $vars;
}

/** Can this part be read online at all? */
function nr_part_is_readable($part_id) {
    return (bool) nr_part_file_path($part_id, 'nr_epub_attachment_id');
}

function nr_get_read_url($part_id) {
    return wp_nonce_url(
        home_url('/noblesee-read/' . $part_id . '/'),
        'nr_read_' . $part_id
    );
}

function nr_get_read_content_url($part_id) {
    return wp_nonce_url(
        home_url('/noblesee-read-content/' . $part_id . '/'),
        'nr_read_' . $part_id
    );
}

function nr_handle_reader_request() {
    $content_part = absint(get_query_var('nr_read_content_part'));
    if ($content_part) {
        nr_serve_reader_content($content_part);
        return;
    }

    $part_id = absint(get_query_var('nr_read_part'));
    if (!$part_id) {
        return; // Not our route.
    }

    $access = nr_guard_part_access($part_id, 'nr_read_');

    if (!nr_part_is_readable($part_id)) {
        nr_access_die(__('This part is not available to read online yet.', 'noblesee-core'), 404);
    }

    // Reading online is the same act of access as downloading, so it
    // starts the staged-release clock and counts toward the daily book
    // limit. Recorded once per window so refreshes don't spam the log.
    NR_Download_Limiter::record_once($access['user_id'], $part_id, $access['book_id'], 'read_online');

    include NR_PLUGIN_DIR . 'templates/reader.php';
    exit;
}

function nr_serve_reader_content($part_id) {
    // Same gate as the reader page. Recording already happened there;
    // repeating it here would log every page turn.
    nr_guard_part_access($part_id, 'nr_read_');

    $file = nr_part_file_path($part_id, 'nr_epub_attachment_id');
    if (!$file) {
        nr_access_die(__('This part is not available to read online yet.', 'noblesee-core'), 404);
    }

    nr_stream_file($file, 'inline');
    exit;
}
