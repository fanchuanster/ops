<?php
/**
 * Book catalog. Theme (Kadence) supplies get_header()/get_footer() chrome
 * and typography; this file supplies structure and data only. A theme
 * can override this whole template with wordpress/themes/<theme>/nobleread/archive-nr_book.php.
 */

if (!defined('ABSPATH')) {
    exit;
}

get_header();
?>
<main id="nr-catalog" class="nr-catalog">
    <header class="nr-catalog-header">
        <?php if (is_tax('nr_collection')) : ?>
            <h1><?php echo esc_html(single_term_title('', false)); ?></h1>
            <?php $term_description = term_description(); ?>
            <?php if ($term_description) : ?>
                <?php echo wp_kses_post($term_description); ?>
            <?php endif; ?>
        <?php else : ?>
            <h1><?php esc_html_e('Books', 'nobleread-core'); ?></h1>
            <p><?php esc_html_e('Valuable, hard-to-find books — digitized, proofread, and made comfortable to read on any device.', 'nobleread-core'); ?></p>
        <?php endif; ?>
    </header>

    <?php echo wp_kses_post(nr_collection_filter_bar()); ?>

    <?php if (have_posts()) : ?>
        <div class="nr-book-grid">
            <?php
            while (have_posts()) :
                the_post();
                include NR_PLUGIN_DIR . 'templates/partials/book-card.php';
            endwhile;
            ?>
        </div>
        <?php the_posts_pagination(); ?>
    <?php else : ?>
        <p><?php esc_html_e('No books have been published yet — check back soon.', 'nobleread-core'); ?></p>
    <?php endif; ?>
</main>
<?php
get_footer();
