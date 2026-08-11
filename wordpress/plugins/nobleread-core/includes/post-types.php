<?php
/**
 * Book / Part content model.
 *
 * Book and Part are two custom post types related by the native
 * `post_parent` column (not a meta-only foreign key) so they stay
 * queryable with core WP_Query (post_parent, post_parent__in) without any
 * custom join tables. See docs/ARCHITECTURE_REVIEW.md for the reasoning.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', 'nr_register_post_types');
add_filter('upload_mimes', 'nr_allow_epub_uploads');

/**
 * EPUB is a primary reader-facing format for NobleRead (CLAUDE.md
 * section 10) but isn't in WordPress core's default upload allowlist —
 * add it explicitly rather than asking admins to change a global setting.
 */
function nr_allow_epub_uploads($mimes) {
    $mimes['epub'] = 'application/epub+zip';
    return $mimes;
}

function nr_register_post_types() {
    register_post_type('nr_book', [
        'labels' => [
            'name' => __('Books', 'nobleread-core'),
            'singular_name' => __('Book', 'nobleread-core'),
            'add_new_item' => __('Add New Book', 'nobleread-core'),
            'edit_item' => __('Edit Book', 'nobleread-core'),
            'all_items' => __('Books', 'nobleread-core'),
            'search_items' => __('Search Books', 'nobleread-core'),
            'not_found' => __('No books found', 'nobleread-core'),
        ],
        'public' => true,
        'has_archive' => 'books',
        'rewrite' => ['slug' => 'books'],
        'menu_icon' => 'dashicons-book-alt',
        'supports' => ['title', 'editor', 'thumbnail'],
        'show_in_rest' => true,
    ]);

    // Parts are not public destinations on their own in this pass — they
    // render inline on their parent Book's page. No separate permalink,
    // no REST exposure yet.
    register_post_type('nr_part', [
        'labels' => [
            'name' => __('Parts', 'nobleread-core'),
            'singular_name' => __('Part', 'nobleread-core'),
            'add_new_item' => __('Add New Part', 'nobleread-core'),
            'edit_item' => __('Edit Part', 'nobleread-core'),
            'all_items' => __('Parts', 'nobleread-core'),
            'search_items' => __('Search Parts', 'nobleread-core'),
            'not_found' => __('No parts found', 'nobleread-core'),
        ],
        'public' => false,
        'show_ui' => true,
        'show_in_menu' => 'edit.php?post_type=nr_book',
        'hierarchical' => true,
        // Deliberately no 'page-attributes' support: WP's built-in Parent
        // dropdown only offers posts of the *same* post type, but a
        // Part's parent is a Book (a different post type). Parent + order
        // are set through the custom meta box in meta-boxes.php instead.
        'supports' => ['title'],
        'show_in_rest' => false,
    ]);

    nr_register_taxonomies();
    nr_register_post_meta();
}

/**
 * Collections group books by subject so the catalog stays browsable as it
 * grows. Hierarchical (category-like, not tag-like) because the intended
 * groupings are a curated shelf structure — "Chinese Classics", with room
 * for sub-shelves later — rather than freeform labelling. The actual
 * shelf structure (Chinese History, Chinese Wisdom, Authors > ..., etc.)
 * is content, not code — see provisioning/setup-catalogs.php.
 */
function nr_register_taxonomies() {
    register_taxonomy('nr_collection', ['nr_book'], [
        'labels' => [
            'name' => __('Collections', 'nobleread-core'),
            'singular_name' => __('Collection', 'nobleread-core'),
            'add_new_item' => __('Add New Collection', 'nobleread-core'),
            'edit_item' => __('Edit Collection', 'nobleread-core'),
            'all_items' => __('Collections', 'nobleread-core'),
            'search_items' => __('Search Collections', 'nobleread-core'),
        ],
        'public' => true,
        'hierarchical' => true,
        'show_admin_column' => true,
        'show_in_rest' => true,
        'rewrite' => ['slug' => 'collections'],
        // Core assigns this automatically to any book published with no
        // collection checked — the "uploading a book always gets a
        // catalog" requirement, with no custom save-time code needed.
        'default_term' => [
            'name' => __('Others', 'nobleread-core'),
            'slug' => 'others',
        ],
    ]);
}

function nr_register_post_meta() {
    $book_meta = [
        'nr_author' => 'string',
        'nr_translator' => 'string',
        'nr_language' => 'string',
        'nr_rights_status' => 'string',
        'nr_staged_release' => 'string',
    ];
    foreach ($book_meta as $key => $type) {
        register_post_meta('nr_book', $key, [
            'show_in_rest' => true,
            'single' => true,
            'type' => $type,
            'auth_callback' => function () {
                return current_user_can('edit_posts');
            },
        ]);
    }

    $part_meta = [
        'nr_docx_attachment_id' => 'integer',
        'nr_epub_attachment_id' => 'integer',
        'nr_pdf_standard_attachment_id' => 'integer',
        'nr_pdf_large_attachment_id' => 'integer',
        'nr_pdf_xl_attachment_id' => 'integer',
        'nr_unlock_delay_hours' => 'string',
        'nr_rights_status' => 'string',
    ];
    foreach ($part_meta as $key => $type) {
        register_post_meta('nr_part', $key, [
            'show_in_rest' => false,
            'single' => true,
            'type' => $type,
            'auth_callback' => function () {
                return current_user_can('edit_posts');
            },
        ]);
    }
}

/**
 * Rights-status vocabulary, per CLAUDE.md section 6 (Copyright / Rights
 * Management). Only the first three are ever publicly downloadable — see
 * nr_downloadable_rights_statuses().
 */
function nr_rights_statuses() {
    return [
        'public_domain' => __('Public domain', 'nobleread-core'),
        'licensed' => __('Licensed', 'nobleread-core'),
        'permission_granted' => __('Permission granted', 'nobleread-core'),
        'user_owned' => __('User-owned (private conversion)', 'nobleread-core'),
        'restricted' => __('Restricted', 'nobleread-core'),
        'unknown' => __('Unknown', 'nobleread-core'),
    ];
}

function nr_downloadable_rights_statuses() {
    return ['public_domain', 'licensed', 'permission_granted'];
}

/**
 * The rights status that actually governs a part: its own override when
 * set, otherwise its book's. Anthologies and compilations can carry a
 * single restricted piece inside an otherwise public-domain volume, so
 * rights have to be expressible at the part level — but the common case
 * stays zero-effort by inheriting.
 */
function nr_effective_rights_status($part_id) {
    $override = get_post_meta($part_id, 'nr_rights_status', true);
    if ($override && array_key_exists($override, nr_rights_statuses())) {
        return $override;
    }

    $part = get_post($part_id);
    $book_id = $part ? (int) $part->post_parent : 0;
    return $book_id ? (string) get_post_meta($book_id, 'nr_rights_status', true) : '';
}
