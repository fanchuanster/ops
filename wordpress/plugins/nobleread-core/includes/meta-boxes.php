<?php
/**
 * Admin meta boxes for Books and Parts. Native register_post_meta +
 * add_meta_box only — no ACF or third-party meta-box plugin, so this
 * business logic stays entirely inside the custom plugin per CLAUDE.md.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('add_meta_boxes', 'nr_add_meta_boxes');
add_action('save_post_nr_book', 'nr_save_book_meta');
add_action('save_post_nr_part', 'nr_save_part_meta');

function nr_add_meta_boxes() {
    add_meta_box('nr_book_details', __('Book Details', 'nobleread-core'), 'nr_render_book_meta_box', 'nr_book', 'normal', 'high');
    add_meta_box('nr_part_details', __('Part Details', 'nobleread-core'), 'nr_render_part_meta_box', 'nr_part', 'normal', 'high');
}

function nr_render_book_meta_box($post) {
    wp_nonce_field('nr_save_book_meta', 'nr_book_meta_nonce');
    $author = get_post_meta($post->ID, 'nr_author', true);
    $translator = get_post_meta($post->ID, 'nr_translator', true);
    $language = get_post_meta($post->ID, 'nr_language', true);
    $rights = get_post_meta($post->ID, 'nr_rights_status', true) ?: 'unknown';
    ?>
    <p>
        <label for="nr_author"><strong><?php esc_html_e('Author', 'nobleread-core'); ?></strong></label><br>
        <input type="text" class="widefat" id="nr_author" name="nr_author" value="<?php echo esc_attr($author); ?>">
    </p>
    <p>
        <label for="nr_translator"><strong><?php esc_html_e('Translator', 'nobleread-core'); ?></strong></label><br>
        <input type="text" class="widefat" id="nr_translator" name="nr_translator" value="<?php echo esc_attr($translator); ?>">
    </p>
    <p>
        <label for="nr_language"><strong><?php esc_html_e('Language', 'nobleread-core'); ?></strong></label><br>
        <input type="text" class="widefat" id="nr_language" name="nr_language" value="<?php echo esc_attr($language); ?>" placeholder="<?php esc_attr_e('e.g. Chinese / English', 'nobleread-core'); ?>">
    </p>
    <p>
        <label for="nr_rights_status"><strong><?php esc_html_e('Rights status', 'nobleread-core'); ?></strong></label><br>
        <select id="nr_rights_status" name="nr_rights_status">
            <?php foreach (nr_rights_statuses() as $value => $label) : ?>
                <option value="<?php echo esc_attr($value); ?>" <?php selected($rights, $value); ?>><?php echo esc_html($label); ?></option>
            <?php endforeach; ?>
        </select>
        <p class="description">
            <?php esc_html_e('Only Public domain, Licensed, or Permission granted books offer public downloads. Every other status is blocked at the download endpoint, regardless of which files are attached to its parts.', 'nobleread-core'); ?>
        </p>
    </p>
    <?php
}

function nr_save_book_meta($post_id) {
    if (!isset($_POST['nr_book_meta_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['nr_book_meta_nonce'])), 'nr_save_book_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    if (isset($_POST['nr_author'])) {
        update_post_meta($post_id, 'nr_author', sanitize_text_field(wp_unslash($_POST['nr_author'])));
    }
    if (isset($_POST['nr_translator'])) {
        update_post_meta($post_id, 'nr_translator', sanitize_text_field(wp_unslash($_POST['nr_translator'])));
    }
    if (isset($_POST['nr_language'])) {
        update_post_meta($post_id, 'nr_language', sanitize_text_field(wp_unslash($_POST['nr_language'])));
    }
    if (isset($_POST['nr_rights_status']) && array_key_exists($_POST['nr_rights_status'], nr_rights_statuses())) {
        update_post_meta($post_id, 'nr_rights_status', sanitize_key($_POST['nr_rights_status']));
    }
}

/**
 * Format => meta key + admin label. Deliberately does NOT include the
 * DOCX master under a public-facing label distinction here beyond the
 * warning text — downloads.php separately hard-excludes 'docx' from the
 * public route allowlist, so even an admin mistake in this list can't
 * make the master directly downloadable.
 */
function nr_part_format_fields() {
    return [
        'nr_docx_attachment_id' => __('DOCX master (private — never publicly downloadable)', 'nobleread-core'),
        'nr_epub_attachment_id' => __('EPUB', 'nobleread-core'),
        'nr_pdf_standard_attachment_id' => __('PDF — Standard', 'nobleread-core'),
        'nr_pdf_large_attachment_id' => __('PDF — Large', 'nobleread-core'),
        'nr_pdf_xl_attachment_id' => __('PDF — Extra Large', 'nobleread-core'),
    ];
}

function nr_render_part_meta_box($post) {
    wp_nonce_field('nr_save_part_meta', 'nr_part_meta_nonce');
    wp_enqueue_media();

    $books = get_posts([
        'post_type' => 'nr_book',
        'posts_per_page' => -1,
        'orderby' => 'title',
        'order' => 'ASC',
        'post_status' => ['publish', 'draft', 'pending', 'future'],
    ]);
    ?>
    <p>
        <label for="nr_part_book_id"><strong><?php esc_html_e('Parent book', 'nobleread-core'); ?></strong></label><br>
        <select id="nr_part_book_id" name="nr_part_book_id">
            <option value="0"><?php esc_html_e('— Select a book —', 'nobleread-core'); ?></option>
            <?php foreach ($books as $book) : ?>
                <option value="<?php echo esc_attr($book->ID); ?>" <?php selected((int) $post->post_parent, $book->ID); ?>>
                    <?php echo esc_html(get_the_title($book)); ?>
                </option>
            <?php endforeach; ?>
        </select>
    </p>
    <p>
        <label for="nr_part_order"><strong><?php esc_html_e('Order', 'nobleread-core'); ?></strong></label><br>
        <input type="number" id="nr_part_order" name="nr_part_order" value="<?php echo esc_attr($post->menu_order); ?>" style="width:6em;">
        <span class="description"><?php esc_html_e('Lower numbers appear first (Part 1, Part 2, …).', 'nobleread-core'); ?></span>
    </p>
    <hr>
    <?php foreach (nr_part_format_fields() as $key => $label) :
        $attachment_id = (int) get_post_meta($post->ID, $key, true);
        $url = $attachment_id ? wp_get_attachment_url($attachment_id) : '';
        ?>
        <p class="nr-file-field" data-field="<?php echo esc_attr($key); ?>">
            <strong><?php echo esc_html($label); ?></strong><br>
            <input type="hidden" name="<?php echo esc_attr($key); ?>" value="<?php echo esc_attr($attachment_id); ?>" class="nr-attachment-id">
            <span class="nr-file-name"><?php echo $url ? esc_html(basename($url)) : esc_html__('No file selected', 'nobleread-core'); ?></span>
            <button type="button" class="button nr-select-file"><?php esc_html_e('Select file', 'nobleread-core'); ?></button>
            <button type="button" class="button nr-clear-file" <?php echo $attachment_id ? '' : 'style="display:none;"'; ?>><?php esc_html_e('Clear', 'nobleread-core'); ?></button>
        </p>
    <?php endforeach; ?>
    <script>
    jQuery(function ($) {
        $('.nr-select-file').on('click', function (e) {
            e.preventDefault();
            var $field = $(this).closest('.nr-file-field');
            var frame = wp.media({ title: '<?php echo esc_js(__('Select file', 'nobleread-core')); ?>', multiple: false });
            frame.on('select', function () {
                var attachment = frame.state().get('selection').first().toJSON();
                $field.find('.nr-attachment-id').val(attachment.id);
                $field.find('.nr-file-name').text(attachment.filename || attachment.title);
                $field.find('.nr-clear-file').show();
            });
            frame.open();
        });
        $('.nr-clear-file').on('click', function (e) {
            e.preventDefault();
            var $field = $(this).closest('.nr-file-field');
            $field.find('.nr-attachment-id').val('');
            $field.find('.nr-file-name').text('<?php echo esc_js(__('No file selected', 'nobleread-core')); ?>');
            $(this).hide();
        });
    });
    </script>
    <?php
}

function nr_save_part_meta($post_id) {
    if (!isset($_POST['nr_part_meta_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['nr_part_meta_nonce'])), 'nr_save_part_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    foreach (array_keys(nr_part_format_fields()) as $key) {
        if (isset($_POST[$key])) {
            update_post_meta($post_id, $key, absint($_POST[$key]));
        }
    }

    // Parent book + order are plain post fields (post_parent, menu_order),
    // not meta — update via wp_update_post, guarding against recursion
    // since this runs on the same save_post_nr_part hook.
    if (isset($_POST['nr_part_book_id']) || isset($_POST['nr_part_order'])) {
        $book_id = isset($_POST['nr_part_book_id']) ? absint($_POST['nr_part_book_id']) : 0;
        $order = isset($_POST['nr_part_order']) ? absint($_POST['nr_part_order']) : 0;

        remove_action('save_post_nr_part', 'nr_save_part_meta');
        wp_update_post([
            'ID' => $post_id,
            'post_parent' => $book_id,
            'menu_order' => $order,
        ]);
        add_action('save_post_nr_part', 'nr_save_part_meta');
    }
}
