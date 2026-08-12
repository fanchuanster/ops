<?php
/**
 * The reading surface. A standalone document rather than a themed page:
 * the point is an uncluttered page of text, so the site chrome, sidebars
 * and footers stay out of it.
 *
 * Expects $part_id in scope (set by nr_handle_reader_request()).
 */

if (!defined('ABSPATH')) {
    exit;
}

$part = get_post($part_id);
$book_id = (int) $part->post_parent;
$book_title = get_the_title($book_id);
$part_title = get_the_title($part_id);
$parts = nr_get_book_parts($book_id);

// Offer the next part only if the reader may actually open it.
$next_part = null;
$seen = false;
foreach ($parts as $sibling) {
    if ($seen) {
        $status = NR_Staged_Release::status($sibling->ID, get_current_user_id());
        if ($status['unlocked'] && nr_part_is_readable($sibling->ID)) {
            $next_part = $sibling;
        }
        break;
    }
    if ((int) $sibling->ID === (int) $part_id) {
        $seen = true;
    }
}
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html($part_title . ' — ' . $book_title); ?></title>
<link rel="stylesheet" href="<?php echo esc_url(NR_PLUGIN_URL . 'assets/css/reader.css?ver=' . NR_VERSION); ?>">
</head>
<body class="nr-reader" data-theme="light">

<header class="nr-reader-bar" id="nr-bar">
    <a class="nr-reader-back" href="<?php echo esc_url(get_permalink($book_id)); ?>" title="<?php esc_attr_e('Back to the book', 'noblesee-core'); ?>">&larr;</a>

    <div class="nr-reader-titles">
        <span class="nr-reader-book"><?php echo esc_html($book_title); ?></span>
        <span class="nr-reader-part"><?php echo esc_html($part_title); ?></span>
    </div>

    <div class="nr-reader-tools">
        <button type="button" id="nr-toc-toggle" aria-expanded="false" title="<?php esc_attr_e('Contents', 'noblesee-core'); ?>"><?php esc_html_e('Contents', 'noblesee-core'); ?></button>
        <button type="button" id="nr-font-smaller" title="<?php esc_attr_e('Smaller text', 'noblesee-core'); ?>">A&minus;</button>
        <button type="button" id="nr-font-larger" title="<?php esc_attr_e('Larger text', 'noblesee-core'); ?>">A+</button>
        <button type="button" id="nr-theme-toggle" title="<?php esc_attr_e('Reading theme', 'noblesee-core'); ?>"><?php esc_html_e('Theme', 'noblesee-core'); ?></button>
    </div>
</header>

<nav class="nr-toc" id="nr-toc" hidden aria-label="<?php esc_attr_e('Contents', 'noblesee-core'); ?>">
    <ol id="nr-toc-list"></ol>
</nav>

<main class="nr-reader-stage">
    <button type="button" class="nr-page-arrow nr-prev" id="nr-prev" aria-label="<?php esc_attr_e('Previous page', 'noblesee-core'); ?>">&lsaquo;</button>
    <div id="nr-viewer" class="nr-viewer"></div>
    <button type="button" class="nr-page-arrow nr-next" id="nr-next" aria-label="<?php esc_attr_e('Next page', 'noblesee-core'); ?>">&rsaquo;</button>
</main>

<div class="nr-reader-status" id="nr-status">
    <span id="nr-progress"></span>
    <?php if ($next_part) : ?>
        <a class="nr-next-part" href="<?php echo esc_url(nr_get_read_url($next_part->ID)); ?>">
            <?php
            printf(
                /* translators: %s: title of the next part */
                esc_html__('Next: %s', 'noblesee-core'),
                esc_html(get_the_title($next_part))
            );
            ?>
        </a>
    <?php endif; ?>
</div>

<noscript>
    <p class="nr-reader-noscript">
        <?php esc_html_e('Reading in the browser needs JavaScript. You can download this part in EPUB or PDF from the book page instead.', 'noblesee-core'); ?>
    </p>
</noscript>

<script src="<?php echo esc_url(NR_PLUGIN_URL . 'assets/js/vendor/jszip.min.js?ver=' . NR_VERSION); ?>"></script>
<script src="<?php echo esc_url(NR_PLUGIN_URL . 'assets/js/vendor/epub.min.js?ver=' . NR_VERSION); ?>"></script>
<script>
window.NR_READER = {
    url: <?php echo wp_json_encode(nr_get_read_content_url($part_id)); ?>,
    key: <?php echo wp_json_encode('nr-reader-' . $part_id); ?>,
    strings: {
        loadError: <?php echo wp_json_encode(__('This book could not be opened. You can still download it from the book page.', 'noblesee-core')); ?>
    }
};
</script>
<script src="<?php echo esc_url(NR_PLUGIN_URL . 'assets/js/reader.js?ver=' . NR_VERSION); ?>"></script>
</body>
</html>
