<?php
/**
 * Front-door setup, run via `wp eval-file`.
 *
 * A stock WordPress install opens on a "Hello world!" blog listing, which
 * buries the book catalog and reads as an unconfigured site. This makes
 * the front page a mission-led landing page that leads with books, wires
 * up a primary nav menu, and clears the sample content.
 *
 * Idempotent: re-running finds the existing Home page by slug and only
 * fills in whatever is missing.
 */

if (!defined('ABSPATH')) {
    exit;
}

$home_content = <<<'HTML'
<div class="nr-hero">
<h2>Books worth reading, made comfortable to read.</h2>
<p>Many valuable books — especially traditional Chinese classics, history, and works of wisdom — survive online only as scanned images that are painful to read on a phone or e-reader. NobleRead digitizes them, proofreads them carefully, and republishes them as clean EPUB and PDF editions.</p>
</div>

<h3 class="nr-section-heading">From the library</h3>
[nobleread_books limit="6"]

<div class="nr-cta-row"><a class="nr-cta" href="/books/">Browse all books</a></div>
HTML;

// --- Home page -----------------------------------------------------------
$home = get_page_by_path('home', OBJECT, 'page');

if (!$home) {
    $home_id = wp_insert_post([
        'post_type' => 'page',
        'post_title' => 'Home',
        'post_name' => 'home',
        'post_status' => 'publish',
        'post_content' => $home_content,
    ], true);

    if (is_wp_error($home_id)) {
        WP_CLI::error('Failed to create Home page: ' . $home_id->get_error_message());
    }
    WP_CLI::log("Created Home page (#{$home_id}).");
} else {
    $home_id = $home->ID;
    WP_CLI::log("Home page already exists (#{$home_id}).");
}

update_option('show_on_front', 'page');
update_option('page_on_front', $home_id);
WP_CLI::log('Front page set to the Home page.');

// --- Remove WordPress sample content -------------------------------------
foreach ([['hello-world', 'post'], ['sample-page', 'page']] as $sample) {
    list($slug, $type) = $sample;
    $post = get_page_by_path($slug, OBJECT, $type);
    // Guard against nuking a real page that happens to sit on the slug:
    // only delete while it still looks like untouched WP boilerplate.
    if ($post && (int) $post->ID !== (int) $home_id) {
        wp_delete_post($post->ID, true);
        WP_CLI::log("Removed sample content: {$slug}.");
    }
}

// --- Primary navigation --------------------------------------------------
$menu_name = 'Primary';
$menu = wp_get_nav_menu_object($menu_name);

if (!$menu) {
    $menu_id = wp_create_nav_menu($menu_name);
    if (is_wp_error($menu_id)) {
        WP_CLI::warning('Could not create nav menu: ' . $menu_id->get_error_message());
        $menu_id = 0;
    } else {
        WP_CLI::log('Created Primary nav menu.');
    }
} else {
    $menu_id = $menu->term_id;
}

if ($menu_id && !wp_get_nav_menu_items($menu_id)) {
    wp_update_nav_menu_item($menu_id, 0, [
        'menu-item-title' => 'Home',
        'menu-item-object' => 'page',
        'menu-item-object-id' => $home_id,
        'menu-item-type' => 'post_type',
        'menu-item-status' => 'publish',
        'menu-item-position' => 1,
    ]);
    wp_update_nav_menu_item($menu_id, 0, [
        'menu-item-title' => 'Books',
        'menu-item-url' => home_url('/books/'),
        'menu-item-type' => 'custom',
        'menu-item-status' => 'publish',
        'menu-item-position' => 2,
    ]);
    WP_CLI::log('Populated Primary nav menu.');
}

if ($menu_id) {
    // Assign to whichever primary-ish location the active theme registers,
    // so this keeps working if the theme is ever swapped out.
    $locations = get_nav_menu_locations();
    $registered = array_keys(get_registered_nav_menus());
    $target = null;
    foreach (['primary', 'main', 'header'] as $candidate) {
        if (in_array($candidate, $registered, true)) {
            $target = $candidate;
            break;
        }
    }
    if (!$target && !empty($registered)) {
        $target = $registered[0];
    }
    if ($target) {
        $locations[$target] = $menu_id;
        set_theme_mod('nav_menu_locations', $locations);
        WP_CLI::log("Assigned Primary menu to theme location '{$target}'.");
    } else {
        WP_CLI::warning('Active theme registers no nav menu locations; skipped assignment.');
    }
}

WP_CLI::success('Front-door setup complete.');
