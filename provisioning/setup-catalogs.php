<?php
/**
 * Catalog (nr_collection) term structure, run via `wp eval-file`.
 *
 * Idempotent: every term is looked up by slug first, so re-running never
 * duplicates a term or its parent relationship.
 *
 * "Others" needs no entry here — nr_register_taxonomies()
 * (includes/post-types.php) registers it as the taxonomy's
 * `default_term`, which WordPress core creates automatically and
 * assigns to any book published without a catalog.
 *
 * Deliberately additive: pre-existing collections from seed content
 * (Chinese Classics, Philosophy & Wisdom, Personal Development — see
 * seed-import.php) are left as they are, not replaced.
 */

if (!defined('ABSPATH')) {
    exit;
}

function nr_setup_ensure_catalog_term($name, $slug, $parent_id = 0) {
    $existing = get_term_by('slug', $slug, 'nr_collection');
    if ($existing) {
        return (int) $existing->term_id;
    }

    $result = wp_insert_term($name, 'nr_collection', [
        'slug' => $slug,
        'parent' => $parent_id,
    ]);
    if (is_wp_error($result)) {
        WP_CLI::warning("Could not create catalog '{$name}': " . $result->get_error_message());
        return 0;
    }

    WP_CLI::log('Created catalog: ' . $name . ($parent_id ? " (under parent #{$parent_id})" : ''));
    return (int) $result['term_id'];
}

nr_setup_ensure_catalog_term('Chinese History', 'chinese-history');
nr_setup_ensure_catalog_term('Chinese Wisdom', 'chinese-wisdom');
$authors_id = nr_setup_ensure_catalog_term('Authors', 'authors');
nr_setup_ensure_catalog_term('Nan Huaijin', 'nan-huaijin', $authors_id);
nr_setup_ensure_catalog_term('Zhang Tianliang', 'zhang-tianliang', $authors_id);

WP_CLI::success('Catalog structure ready.');
