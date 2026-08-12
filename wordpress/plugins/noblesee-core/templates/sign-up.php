<?php
/**
 * The sign-up page (/sign-up/). Included by nr_render_sign_up_page()
 * (includes/auth.php), which already wraps it in get_header()/
 * get_footer() — this file is just the form.
 *
 * Expects $errors (string[]), $posted_name, $posted_email in scope, set
 * by nr_handle_sign_up_request().
 */

if (!defined('ABSPATH')) {
    exit;
}

$redirect_to = isset($_GET['redirect_to']) ? sanitize_text_field(wp_unslash($_GET['redirect_to'])) : '';
$google_url = nr_google_oauth_configured()
    ? add_query_arg('redirect_to', $redirect_to, home_url('/auth/google/start/'))
    : '';
?>
<main class="nr-sign-up">
    <h1><?php esc_html_e('Create your free account', 'noblesee-core'); ?></h1>
    <p class="nr-sign-up-sub">
        <?php esc_html_e('Reading and downloading is free — an account just keeps your daily limit tied to you, not your browser.', 'noblesee-core'); ?>
    </p>

    <?php if (isset($_GET['oauth_error'])) : ?>
        <p class="nr-form-error"><?php esc_html_e('That sign-up attempt was cancelled or ran into a problem. Please try again, or use the form below.', 'noblesee-core'); ?></p>
    <?php endif; ?>

    <?php if (!empty($errors)) : ?>
        <ul class="nr-form-error">
            <?php foreach ($errors as $error) : ?>
                <li><?php echo wp_kses($error, ['a' => ['href' => []]]); ?></li>
            <?php endforeach; ?>
        </ul>
    <?php endif; ?>

    <?php if ($google_url) : ?>
        <a class="nr-google-btn" href="<?php echo esc_url($google_url); ?>">
            <?php esc_html_e('Continue with Google', 'noblesee-core'); ?>
        </a>
        <div class="nr-sign-up-divider"><span><?php esc_html_e('or', 'noblesee-core'); ?></span></div>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(home_url('/sign-up/')); ?>" class="nr-sign-up-form">
        <?php wp_nonce_field('nr_sign_up', 'nr_sign_up_nonce'); ?>
        <input type="hidden" name="redirect_to" value="<?php echo esc_attr($redirect_to); ?>">

        <p>
            <label for="nr_name"><?php esc_html_e('Name', 'noblesee-core'); ?></label>
            <input type="text" id="nr_name" name="nr_name" value="<?php echo esc_attr($posted_name); ?>" required>
        </p>
        <p>
            <label for="nr_email"><?php esc_html_e('Email', 'noblesee-core'); ?></label>
            <input type="email" id="nr_email" name="nr_email" value="<?php echo esc_attr($posted_email); ?>" required>
        </p>
        <p>
            <label for="nr_password"><?php esc_html_e('Password', 'noblesee-core'); ?></label>
            <input type="password" id="nr_password" name="nr_password" minlength="8" required>
        </p>
        <p>
            <button type="submit" class="nr-cta"><?php esc_html_e('Create account', 'noblesee-core'); ?></button>
        </p>
    </form>

    <p class="nr-sign-up-login">
        <?php
        printf(
            wp_kses(
                /* translators: %s: login URL */
                __('Already have an account? <a href="%s">Log in</a>.', 'noblesee-core'),
                ['a' => ['href' => []]]
            ),
            esc_url(wp_login_url($redirect_to ?: home_url('/')))
        );
        ?>
    </p>
</main>
