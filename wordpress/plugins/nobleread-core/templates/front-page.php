<?php
/**
 * Front page (the "Home" page set via show_on_front/page_on_front in
 * provisioning/setup-site.php). Adds the catalog sidebar around the
 * page's own content rather than hard-coding the hero copy here, so
 * that copy stays a normal WP-admin-editable page — same layout as the
 * book archive (templates/archive-nr_book.php), so "browse by
 * collection" works identically everywhere, starting from "/".
 */

if (!defined('ABSPATH')) {
    exit;
}

get_header();
?>
<div class="nr-catalog-layout">
    <?php echo wp_kses_post(nr_catalog_sidebar()); ?>
    <main class="nr-catalog-main">
        <?php
        while (have_posts()) :
            the_post();
            the_content();
        endwhile;
        ?>
    </main>
</div>
<?php
get_footer();
