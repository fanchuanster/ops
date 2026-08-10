<?php
/**
 * Front-end wiring: catalog/single-book templates and small template-tag
 * helpers. Presentation only — the theme supplies CSS/typography, this
 * plugin supplies structure and data, matching WooCommerce's own
 * template_include convention so a theme can override by dropping a
 * `nobleread/{name}.php` file in its own directory.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('template_include', 'nr_template_include');
add_action('wp_enqueue_scripts', 'nr_enqueue_assets');

function nr_template_include($template) {
    if (is_post_type_archive('nr_book')) {
        return nr_locate_template('archive-nr_book.php', $template);
    }
    if (is_singular('nr_book')) {
        return nr_locate_template('single-nr_book.php', $template);
    }
    return $template;
}

function nr_locate_template($name, $fallback) {
    $theme_override = locate_template(['nobleread/' . $name]);
    if ($theme_override) {
        return $theme_override;
    }
    $plugin_template = NR_PLUGIN_DIR . 'templates/' . $name;
    return file_exists($plugin_template) ? $plugin_template : $fallback;
}

function nr_enqueue_assets() {
    if (is_post_type_archive('nr_book') || is_singular('nr_book')) {
        wp_enqueue_style('nobleread-core', NR_PLUGIN_URL . 'assets/css/nobleread.css', [], NR_VERSION);
    }
}

function nr_get_book_parts($book_id) {
    return get_posts([
        'post_type' => 'nr_part',
        'post_parent' => $book_id,
        'posts_per_page' => -1,
        'orderby' => 'menu_order',
        'order' => 'ASC',
        'post_status' => 'publish',
    ]);
}

function nr_get_download_url($part_id, $format) {
    $url = home_url('/nobleread-download/' . $part_id . '/' . $format . '/');
    return wp_nonce_url($url, 'nr_download_' . $part_id);
}

function nr_part_available_formats($part_id) {
    $available = [];
    foreach (nr_download_format_map() as $format => $meta) {
        $attachment_id = (int) get_post_meta($part_id, $meta['meta'], true);
        if ($attachment_id) {
            $available[$format] = $meta['label'];
        }
    }
    return $available;
}

function nr_rights_badge($book_id) {
    $rights = get_post_meta($book_id, 'nr_rights_status', true) ?: 'unknown';
    $labels = nr_rights_statuses();
    $downloadable = in_array($rights, nr_downloadable_rights_statuses(), true);
    $class = $downloadable ? 'nr-badge nr-badge-ok' : 'nr-badge nr-badge-restricted';
    return sprintf(
        '<span class="%s">%s</span>',
        esc_attr($class),
        esc_html($labels[$rights] ?? $rights)
    );
}
