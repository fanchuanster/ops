<?php
/** Single card in the catalog grid. Expects the loop to be positioned. */

if (!defined('ABSPATH')) {
    exit;
}
?>
<article <?php post_class('nr-book-card'); ?>>
    <a href="<?php the_permalink(); ?>" class="nr-book-card-cover">
        <?php if (has_post_thumbnail()) : ?>
            <?php the_post_thumbnail('medium'); ?>
        <?php else : ?>
            <span class="nr-book-card-cover-placeholder" aria-hidden="true"></span>
        <?php endif; ?>
    </a>
    <h2 class="nr-book-card-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
    <?php $author = get_post_meta(get_the_ID(), 'nr_author', true); ?>
    <?php if ($author) : ?>
        <p class="nr-book-card-author"><?php echo esc_html($author); ?></p>
    <?php endif; ?>
    <?php echo wp_kses_post(nr_rights_badge(get_the_ID())); ?>
</article>
