<?php
/**
 * Shortcodes, so editors can compose pages (e.g. the front page) in
 * Gutenberg without the theme needing any NobleRead-specific knowledge.
 *
 *   [nobleread_books limit="6"]
 *
 * Renders the same book-card grid as the catalog archive, reusing the
 * shared partial and stylesheet so the two never drift apart.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_shortcode('nobleread_books', 'nr_books_shortcode');

function nr_books_shortcode($atts) {
    $atts = shortcode_atts(
        [
            'limit' => 6,
            'orderby' => 'date',
            'order' => 'DESC',
        ],
        $atts,
        'nobleread_books'
    );

    $query = new WP_Query([
        'post_type' => 'nr_book',
        'post_status' => 'publish',
        'posts_per_page' => (int) $atts['limit'],
        'orderby' => sanitize_key($atts['orderby']),
        'order' => 'DESC' === strtoupper($atts['order']) ? 'DESC' : 'ASC',
        'ignore_sticky_posts' => true,
    ]);

    if (!$query->have_posts()) {
        return '<p>' . esc_html__('No books have been published yet — check back soon.', 'nobleread-core') . '</p>';
    }

    // The archive template enqueues this itself; shortcodes can land on
    // any page, so enqueue here too (wp_enqueue_style is idempotent).
    wp_enqueue_style('nobleread-core', NR_PLUGIN_URL . 'assets/css/nobleread.css', [], NR_VERSION);

    ob_start();
    echo '<div class="nr-book-grid">';
    while ($query->have_posts()) {
        $query->the_post();
        include NR_PLUGIN_DIR . 'templates/partials/book-card.php';
    }
    echo '</div>';
    wp_reset_postdata();

    return ob_get_clean();
}
