<?php
/**
 * Single book page: metadata, rights badge, description, and the parts
 * list with per-format download buttons. Logged-out visitors see a
 * login/register prompt instead of dead download links, since the
 * download route itself requires auth (per-user rate limiting needs a
 * real identity, not just an IP/cookie).
 */

if (!defined('ABSPATH')) {
    exit;
}

get_header();

while (have_posts()) :
    the_post();
    $book_id = get_the_ID();
    $author = get_post_meta($book_id, 'nr_author', true);
    $translator = get_post_meta($book_id, 'nr_translator', true);
    $language = get_post_meta($book_id, 'nr_language', true);
    $parts = nr_get_book_parts($book_id);
    ?>
    <main id="nr-book" class="nr-book-single">
        <article <?php post_class(); ?>>
            <header class="nr-book-header">
                <?php if (has_post_thumbnail()) : ?>
                    <div class="nr-book-cover"><?php the_post_thumbnail('medium'); ?></div>
                <?php endif; ?>
                <div class="nr-book-meta">
                    <h1><?php the_title(); ?></h1>
                    <?php if ($author) : ?>
                        <p class="nr-book-author"><?php esc_html_e('By', 'noblesee-core'); ?> <?php echo esc_html($author); ?></p>
                    <?php endif; ?>
                    <?php if ($translator) : ?>
                        <p class="nr-book-translator"><?php esc_html_e('Translated by', 'noblesee-core'); ?> <?php echo esc_html($translator); ?></p>
                    <?php endif; ?>
                    <?php if ($language) : ?>
                        <p class="nr-book-language"><?php echo esc_html($language); ?></p>
                    <?php endif; ?>
                    <?php echo wp_kses_post(nr_book_collections($book_id)); ?>
                    <?php echo wp_kses_post(nr_rights_badge($book_id)); ?>
                </div>
            </header>

            <div class="nr-book-description"><?php the_content(); ?></div>

            <section class="nr-book-parts">
                <h2><?php esc_html_e('Parts', 'noblesee-core'); ?></h2>

                <?php if (empty($parts)) : ?>
                    <p><?php esc_html_e('Parts for this book are being prepared.', 'noblesee-core'); ?></p>
                <?php elseif (!is_user_logged_in()) : ?>
                    <p class="nr-login-prompt">
                        <?php
                        printf(
                            wp_kses(
                                /* translators: 1: login URL, 2: registration URL */
                                __('<a href="%1$s">Log in</a> or <a href="%2$s">create a free account</a> to read and download.', 'noblesee-core'),
                                ['a' => ['href' => []]]
                            ),
                            esc_url(wp_login_url(get_permalink())),
                            esc_url(wp_registration_url())
                        );
                        ?>
                    </p>
                <?php else : ?>
                    <ul class="nr-part-list">
                        <?php foreach ($parts as $part) :
                            $formats = nr_part_available_formats($part->ID);
                            $staged = NR_Staged_Release::status($part->ID, get_current_user_id());
                            ?>
                            <li class="nr-part<?php echo $staged['unlocked'] ? '' : ' nr-part-locked'; ?>">
                                <span class="nr-part-title"><?php echo esc_html(get_the_title($part)); ?></span>
                                <?php if (empty($formats)) : ?>
                                    <span class="nr-part-pending"><?php esc_html_e('Coming soon', 'noblesee-core'); ?></span>
                                <?php elseif (!$staged['unlocked']) : ?>
                                    <span class="nr-part-lock">
                                        <?php echo esc_html(NR_Staged_Release::lock_message($staged)); ?>
                                    </span>
                                <?php else : ?>
                                    <span class="nr-part-downloads">
                                        <?php if (nr_part_is_readable($part->ID)) : ?>
                                            <a class="nr-read-btn" href="<?php echo esc_url(nr_get_read_url($part->ID)); ?>">
                                                <?php esc_html_e('Read online', 'noblesee-core'); ?>
                                            </a>
                                        <?php endif; ?>
                                        <?php foreach ($formats as $format => $label) : ?>
                                            <a class="nr-download-btn" href="<?php echo esc_url(nr_get_download_url($part->ID, $format)); ?>">
                                                <?php echo esc_html($label); ?>
                                            </a>
                                        <?php endforeach; ?>
                                    </span>
                                <?php endif; ?>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                    <p class="nr-remaining-note">
                        <?php
                        if (!NR_Download_Limiter::counts_against_limit(get_current_user_id(), $book_id)) {
                            esc_html_e("You've already started this book today — every format and part of it is free to download.", 'noblesee-core');
                        } else {
                            printf(
                                /* translators: %d: number of further books the reader may start today */
                                esc_html__('You can start %d more book(s) today. Once you start one, all of its parts and formats are free.', 'noblesee-core'),
                                (int) NR_Download_Limiter::remaining(get_current_user_id())
                            );
                        }
                        ?>
                    </p>
                <?php endif; ?>
            </section>
        </article>
    </main>
    <?php
endwhile;

get_footer();
