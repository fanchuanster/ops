<?php
/**
 * Front-end wiring: catalog/single-book templates and small template-tag
 * helpers. Presentation only — the theme supplies CSS/typography, this
 * plugin supplies structure and data, matching WooCommerce's own
 * template_include convention so a theme can override by dropping a
 * `noblesee/{name}.php` file in its own directory.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('template_include', 'nr_template_include');
add_action('wp_enqueue_scripts', 'nr_enqueue_assets');

function nr_template_include($template) {
    // Collection archives reuse the catalog layout — same grid, filtered
    // set — rather than duplicating a near-identical template.
    if (is_post_type_archive('nr_book') || is_tax('nr_collection')) {
        return nr_locate_template('archive-nr_book.php', $template);
    }
    if (is_singular('nr_book')) {
        return nr_locate_template('single-nr_book.php', $template);
    }
    // The front page keeps its own WP-admin-editable content (hero copy,
    // the [noblesee_books] shortcode) — this only wraps it with the same
    // catalog sidebar the archive uses, so a visitor lands on "/" already
    // able to browse by collection, not just see the latest few books.
    if (is_front_page()) {
        return nr_locate_template('front-page.php', $template);
    }
    return $template;
}

function nr_locate_template($name, $fallback) {
    $theme_override = locate_template(['noblesee/' . $name]);
    if ($theme_override) {
        return $theme_override;
    }
    $plugin_template = NR_PLUGIN_DIR . 'templates/' . $name;
    return file_exists($plugin_template) ? $plugin_template : $fallback;
}

function nr_enqueue_assets() {
    if (is_post_type_archive('nr_book') || is_tax('nr_collection') || is_singular('nr_book') || is_front_page() || get_query_var('nr_sign_up')) {
        wp_enqueue_style('noblesee-core', NR_PLUGIN_URL . 'assets/css/noblesee.css', [], NR_VERSION);
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
    $url = home_url('/noblesee-download/' . $part_id . '/' . $format . '/');
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

/**
 * The left-panel catalog navigation: a hierarchical tree of nr_collection
 * terms (e.g. "Authors" as a parent of "Nan Huaijin"/"Zhang Tianliang" —
 * the actual shelf structure is content, set up in
 * provisioning/setup-catalogs.php, not hard-coded here) plus an "All
 * books" link at the top. A book can carry more than one collection —
 * that's just wp_set_object_terms() allowing multiple terms, nothing
 * special on this end.
 *
 * Built on wp_list_categories() (works with any hierarchical taxonomy,
 * not just post categories) rather than hand-rolling tree-building and
 * current-item highlighting. Returns '' when the taxonomy has no terms
 * at all, so a brand-new install doesn't show an empty nav.
 */
function nr_catalog_sidebar() {
    $current = is_tax('nr_collection') ? (int) get_queried_object_id() : 0;

    $items = wp_list_categories([
        'taxonomy' => 'nr_collection',
        'title_li' => '',
        'hide_empty' => false,
        'hierarchical' => true,
        'current_category' => $current,
        'echo' => false,
    ]);

    if (!$items) {
        return '';
    }

    return sprintf(
        '<nav class="nr-catalog-sidebar" aria-label="%1$s"><h2 class="nr-catalog-sidebar-heading">%1$s</h2><ul><li class="nr-catalog-all%2$s"><a href="%3$s">%4$s</a></li>%5$s</ul></nav>',
        esc_attr__('Collections', 'noblesee-core'),
        $current ? '' : ' current-cat',
        esc_url(get_post_type_archive_link('nr_book')),
        esc_html__('All books', 'noblesee-core'),
        $items
    );
}

/** Collection links for a single book, or '' if it has none. */
function nr_book_collections($book_id) {
    $terms = get_the_terms($book_id, 'nr_collection');
    if (!$terms || is_wp_error($terms)) {
        return '';
    }
    $links = [];
    foreach ($terms as $term) {
        $links[] = sprintf(
            '<a class="nr-collection-link" href="%s">%s</a>',
            esc_url(get_term_link($term)),
            esc_html($term->name)
        );
    }
    return '<p class="nr-book-collections">' . implode(' · ', $links) . '</p>';
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
