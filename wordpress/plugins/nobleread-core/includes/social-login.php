<?php
/**
 * Sign up / sign in with Google (OAuth2/OIDC via league/oauth2-client +
 * league/oauth2-google — mature, widely used libraries, not a hand-rolled
 * SigV4-style signer, same reasoning as includes/storage.php's choice of
 * aws-sdk-php over a custom S3 client). Scoped to Google only for now —
 * Apple Sign In needs a paid Apple Developer Program membership plus
 * Apple-side setup (Services ID, private key, Team ID) the account owner
 * has to do first; see docs/ROADMAP.md. Written so a second provider can
 * slot in beside nr_google_oauth_provider() without touching the
 * account-linking logic below, which isn't Google-specific.
 *
 * Flow:
 *   GET /auth/google/start/    redirect to Google's consent screen
 *   GET /auth/google/callback/ exchange the code, sign the reader in
 *
 * CSRF: the "state" round-trip uses a short-lived cookie, not a WP
 * nonce. A WP nonce for a logged-out visitor is the same value for every
 * anonymous visitor in a given time window (there's no session to key it
 * to), so it doesn't bind the callback to *this browser's* request —
 * exactly what OAuth's state parameter exists to prevent (an attacker
 * completing their own consent flow, then handing the victim's browser
 * a callback URL carrying the attacker's code, silently logging the
 * victim into the attacker's account). The state cookie is single-use:
 * cleared as soon as the callback reads it, valid or not.
 *
 * Trust: an account is only ever matched/created from an email Google
 * itself reports as verified (GoogleUser::getEmailVerified()). Without
 * that, an attacker could register a Google account claiming someone
 * else's address and take over their NobleRead account by email match.
 */

if (!defined('ABSPATH')) {
    exit;
}

const NR_OAUTH_STATE_COOKIE = 'nr_oauth_state';

add_action('init', 'nr_add_social_login_rewrites');
add_filter('query_vars', 'nr_add_social_login_query_vars');
add_action('template_redirect', 'nr_handle_social_login_request');

function nr_add_social_login_rewrites() {
    add_rewrite_rule('^auth/google/start/?$', 'index.php?nr_oauth_step=start', 'top');
    add_rewrite_rule('^auth/google/callback/?$', 'index.php?nr_oauth_step=callback', 'top');
}

function nr_add_social_login_query_vars($vars) {
    $vars[] = 'nr_oauth_step';
    return $vars;
}

/** True once real Google OAuth credentials are configured via environment variables. */
function nr_google_oauth_configured() {
    return (bool) (nr_env('GOOGLE_OAUTH_CLIENT_ID') && nr_env('GOOGLE_OAUTH_CLIENT_SECRET'));
}

/**
 * Lazily built Google OAuth provider. The redirect URI is always derived
 * from home_url() rather than a separate env var, so there's exactly one
 * place the site's own URL comes from — but that means it must be
 * registered in Google Cloud Console exactly as
 * {WORDPRESS_URL}/auth/google/callback/ (see .env.example).
 */
function nr_google_oauth_provider() {
    require_once NR_PLUGIN_DIR . 'vendor/autoload.php';

    return new \League\OAuth2\Client\Provider\Google([
        'clientId' => nr_env('GOOGLE_OAUTH_CLIENT_ID'),
        'clientSecret' => nr_env('GOOGLE_OAUTH_CLIENT_SECRET'),
        'redirectUri' => home_url('/auth/google/callback/'),
    ]);
}

function nr_handle_social_login_request() {
    $step = get_query_var('nr_oauth_step');
    if (!$step) {
        return;
    }

    if (!nr_google_oauth_configured()) {
        nr_access_die(__('Google sign-up is not available right now.', 'nobleread-core'), 404);
    }

    if ('start' === $step) {
        nr_start_google_oauth();
    } elseif ('callback' === $step) {
        nr_handle_google_oauth_callback();
    }
    exit;
}

function nr_start_google_oauth() {
    $provider = nr_google_oauth_provider();

    $authorize_url = $provider->getAuthorizationUrl([
        'scope' => ['openid', 'email', 'profile'],
    ]);

    nr_set_oauth_state_cookie($provider->getState(), nr_post_login_redirect());

    // External destination (Google's own consent screen) — wp_redirect(),
    // not wp_safe_redirect(), which would reject a non-local host.
    wp_redirect($authorize_url);
}

function nr_set_oauth_state_cookie($token, $redirect_to) {
    $payload = base64_encode(wp_json_encode(['token' => $token, 'redirect_to' => $redirect_to]));
    setcookie(NR_OAUTH_STATE_COOKIE, $payload, [
        'expires' => time() + 600,
        'path' => '/',
        'secure' => is_ssl(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Reads and immediately clears the state cookie — single-use, whether or not it turns out to be valid. */
function nr_consume_oauth_state_cookie() {
    $raw = isset($_COOKIE[NR_OAUTH_STATE_COOKIE]) ? (string) $_COOKIE[NR_OAUTH_STATE_COOKIE] : '';
    setcookie(NR_OAUTH_STATE_COOKIE, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => is_ssl(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    $decoded = json_decode((string) base64_decode($raw, true), true);
    if (!is_array($decoded) || empty($decoded['token'])) {
        return null;
    }
    return $decoded;
}

function nr_handle_google_oauth_callback() {
    $state_data = nr_consume_oauth_state_cookie();
    $given_state = isset($_GET['state']) ? (string) $_GET['state'] : '';

    if (!$state_data || !$given_state || !hash_equals($state_data['token'], $given_state)) {
        nr_access_die(__('This sign-up link has expired. Please go back and try again.', 'nobleread-core'), 403);
    }

    $redirect_to = wp_validate_redirect((string) ($state_data['redirect_to'] ?? ''), home_url('/'));

    if (isset($_GET['error']) || !isset($_GET['code'])) {
        // Most commonly the visitor clicked "Cancel" on Google's consent
        // screen — that's not an error worth alarming them with, back to
        // the sign-up page they came from.
        wp_safe_redirect(add_query_arg('oauth_error', 'google', nr_sign_up_url()));
        exit;
    }

    $provider = nr_google_oauth_provider();

    try {
        $token = $provider->getAccessToken('authorization_code', ['code' => (string) $_GET['code']]);
        $google_user = $provider->getResourceOwner($token);
    } catch (\Throwable $e) {
        error_log('NobleRead: Google OAuth token exchange failed: ' . $e->getMessage());
        wp_safe_redirect(add_query_arg('oauth_error', 'google', nr_sign_up_url()));
        exit;
    }

    $email = $google_user->getEmail();
    if (!$email || !$google_user->getEmailVerified()) {
        nr_access_die(__("We couldn't verify your Google account's email address.", 'nobleread-core'), 403);
    }

    $user_id = nr_find_or_create_google_user($google_user->getId(), $email, $google_user->getName());
    nr_log_in_new_user($user_id);

    wp_safe_redirect($redirect_to);
}

/**
 * Match by a previously linked Google account id first (nr_google_sub),
 * then fall back to an existing WordPress account with the same email
 * (safe only because the caller already required Google's
 * email_verified claim), then create a new subscriber account.
 */
function nr_find_or_create_google_user($google_sub, $email, $name) {
    $existing = get_users([
        'meta_key' => 'nr_google_sub',
        'meta_value' => $google_sub,
        'number' => 1,
        'fields' => 'ID',
    ]);
    if (!empty($existing)) {
        return (int) $existing[0];
    }

    $by_email = get_user_by('email', $email);
    if ($by_email) {
        update_user_meta($by_email->ID, 'nr_google_sub', $google_sub);
        return (int) $by_email->ID;
    }

    $user_id = wp_insert_user([
        'user_login' => nr_unique_username_from_email($email),
        'user_email' => $email,
        'user_pass' => wp_generate_password(32, true, true),
        'display_name' => $name ?: (string) strstr($email, '@', true),
        'role' => 'subscriber',
    ]);
    if (is_wp_error($user_id)) {
        nr_access_die($user_id->get_error_message(), 500);
    }

    update_user_meta($user_id, 'nr_google_sub', $google_sub);
    wp_new_user_notification($user_id, null, 'admin');

    return (int) $user_id;
}
