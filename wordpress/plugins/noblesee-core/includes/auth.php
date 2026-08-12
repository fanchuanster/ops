<?php
/**
 * Custom sign-up page at /sign-up/, replacing WordPress's default
 * wp-login.php?action=register. Every entry point that would normally
 * send someone to that default form is redirected here instead
 * (nr_sign_up_url() via the core `register_url` filter, which
 * wp_registration_url() already respects — see the "create a free
 * account" link on templates/single-nr_book.php — and
 * nr_redirect_default_registration() for anyone hitting the old URL
 * directly), so the plain WP form is never actually reachable.
 *
 * Handles the traditional name + email + password path. "Continue with
 * Google" on the same page is includes/social-login.php's job — the two
 * are independent entry points into the same subscriber-role account
 * creation, not layered on top of each other. nr_unique_username_from_email()
 * and nr_post_login_redirect() below are shared by both.
 *
 * Deliberately skips a confirm-your-email step before allowing login —
 * no confirmation-link subsystem here. That's the same trust level
 * WordPress's own registration already had (it e-mails a set-password
 * link to whatever address was typed in; it doesn't verify ownership
 * before creating the account either) and it matches the Google path,
 * which trusts Google's own verified-email claim instead. Revisit if
 * abuse shows up — see docs/ROADMAP.md.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', 'nr_add_sign_up_rewrite');
add_filter('query_vars', 'nr_add_sign_up_query_vars');
add_filter('register_url', 'nr_sign_up_url');
add_action('login_init', 'nr_redirect_default_registration');
add_action('template_redirect', 'nr_handle_sign_up_request');

function nr_add_sign_up_rewrite() {
    add_rewrite_rule('^sign-up/?$', 'index.php?nr_sign_up=1', 'top');
}

function nr_add_sign_up_query_vars($vars) {
    $vars[] = 'nr_sign_up';
    return $vars;
}

function nr_sign_up_url() {
    return home_url('/sign-up/');
}

/** wp-login.php?action=register is never shown — send visitors to the real page instead. */
function nr_redirect_default_registration() {
    if (isset($_GET['action']) && 'register' === $_GET['action']) {
        wp_safe_redirect(nr_sign_up_url());
        exit;
    }
}

/**
 * Validated post-auth destination. Reads from $_REQUEST (not just
 * $_GET/$_POST) so it works the same whether it arrived as a query
 * string on the initial /sign-up/?redirect_to=... link or as a hidden
 * field carried through the sign-up form's POST — one helper, one
 * validation path, used by both the traditional and Google flows.
 */
function nr_post_login_redirect() {
    $target = isset($_REQUEST['redirect_to']) ? esc_url_raw(wp_unslash($_REQUEST['redirect_to'])) : '';
    return $target ? wp_validate_redirect($target, home_url('/')) : home_url('/');
}

/**
 * A free, unique username derived from an email address's local part —
 * used for both the traditional form (so readers only ever think about
 * "name, email, password", not a separate username) and new accounts
 * created via Google sign-up (which has no username to offer at all).
 */
function nr_unique_username_from_email($email) {
    $base = sanitize_user(strtolower((string) strstr($email, '@', true)), true);
    if ('' === $base) {
        $base = 'reader';
    }

    $username = $base;
    $suffix = 1;
    while (username_exists($username)) {
        $suffix++;
        $username = $base . $suffix;
    }
    return $username;
}

function nr_handle_sign_up_request() {
    if (!get_query_var('nr_sign_up')) {
        return;
    }

    if (is_user_logged_in()) {
        wp_safe_redirect(nr_post_login_redirect());
        exit;
    }

    $errors = [];
    $posted_name = '';
    $posted_email = '';

    if ('POST' === ($_SERVER['REQUEST_METHOD'] ?? '')) {
        $posted_name = isset($_POST['nr_name']) ? sanitize_text_field(wp_unslash($_POST['nr_name'])) : '';
        $posted_email = isset($_POST['nr_email']) ? sanitize_email(wp_unslash($_POST['nr_email'])) : '';
        $errors = nr_process_sign_up_submission($posted_name, $posted_email);
        // On success nr_process_sign_up_submission() has already redirected
        // and exited; reaching here means $errors is non-empty.
    }

    nr_render_sign_up_page($errors, $posted_name, $posted_email);
    exit;
}

/** @return string[] Validation/creation error messages; empty means success (and this function does not return). */
function nr_process_sign_up_submission($name, $email) {
    $nonce = isset($_POST['nr_sign_up_nonce']) ? sanitize_text_field(wp_unslash($_POST['nr_sign_up_nonce'])) : '';
    if (!wp_verify_nonce($nonce, 'nr_sign_up')) {
        return [__('Your session expired — please try again.', 'noblesee-core')];
    }

    $password = isset($_POST['nr_password']) ? (string) wp_unslash($_POST['nr_password']) : '';

    $errors = [];
    if ('' === $name) {
        $errors[] = __('Please enter your name.', 'noblesee-core');
    }
    if ('' === $email || !is_email($email)) {
        $errors[] = __('Please enter a valid email address.', 'noblesee-core');
    } elseif (email_exists($email)) {
        $errors[] = sprintf(
            /* translators: %s: login URL */
            wp_kses(__('An account with that email already exists. <a href="%s">Log in instead</a>.', 'noblesee-core'), ['a' => ['href' => []]]),
            esc_url(wp_login_url(nr_post_login_redirect()))
        );
    }
    if (strlen($password) < 8) {
        $errors[] = __('Please choose a password of at least 8 characters.', 'noblesee-core');
    }

    if (!empty($errors)) {
        return $errors;
    }

    $user_id = wp_insert_user([
        'user_login' => nr_unique_username_from_email($email),
        'user_email' => $email,
        'user_pass' => $password,
        'display_name' => $name,
        'role' => 'subscriber',
    ]);

    if (is_wp_error($user_id)) {
        return [$user_id->get_error_message()];
    }

    nr_log_in_new_user($user_id);
    wp_new_user_notification($user_id, null, 'both');

    wp_safe_redirect(nr_post_login_redirect());
    exit;
}

/** Shared by the traditional and Google sign-up paths: start an authenticated session for a freshly created/matched user. */
function nr_log_in_new_user($user_id) {
    wp_set_current_user($user_id);
    wp_set_auth_cookie($user_id, true, is_ssl());
    /** This action is documented in wp-includes/user.php (fired by wp_signon() on normal logins). */
    do_action('wp_login', wp_get_current_user()->user_login, wp_get_current_user());
}

function nr_render_sign_up_page($errors, $posted_name, $posted_email) {
    get_header();
    include NR_PLUGIN_DIR . 'templates/sign-up.php';
    get_footer();
}
