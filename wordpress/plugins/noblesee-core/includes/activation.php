<?php
/**
 * Activation / deactivation. Registration is deliberately idempotent
 * (dbDelta, add_option, flush_rewrite_rules) so re-activating never
 * duplicates or clobbers state.
 */

if (!defined('ABSPATH')) {
    exit;
}

function nr_activate_plugin() {
    nr_register_post_types();
    // The 'init' hook (which normally calls this) has already fired for
    // this request by the time an activation hook runs, so the download
    // rewrite rule must be registered explicitly here too, or the
    // flush below would save a rewrite_rules option that's missing it.
    nr_add_download_rewrite();
    nr_add_reader_rewrites();
    nr_add_sign_up_rewrite();
    nr_add_social_login_rewrites();
    NR_Download_Limiter::create_table();
    add_option('nr_download_limit_per_day', 5);
    flush_rewrite_rules();
}

function nr_deactivate_plugin() {
    flush_rewrite_rules();
}
