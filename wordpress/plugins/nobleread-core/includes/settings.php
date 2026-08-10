<?php
/**
 * Settings > NobleRead — currently just the per-user daily download
 * limit. Kept minimal on purpose; grows as later roadmap features land.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('admin_menu', 'nr_add_settings_page');
add_action('admin_init', 'nr_register_settings');

function nr_add_settings_page() {
    add_options_page(
        __('NobleRead', 'nobleread-core'),
        __('NobleRead', 'nobleread-core'),
        'manage_options',
        'nobleread-core',
        'nr_render_settings_page'
    );
}

function nr_register_settings() {
    register_setting('nobleread_core', 'nr_download_limit_per_day', [
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 5,
    ]);
    register_setting('nobleread_core', 'nr_unlock_delay_hours', [
        'type' => 'integer',
        'sanitize_callback' => 'absint',
        'default' => 72,
    ]);
}

function nr_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('NobleRead Settings', 'nobleread-core'); ?></h1>
        <form method="post" action="options.php">
            <?php settings_fields('nobleread_core'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row">
                        <label for="nr_download_limit_per_day"><?php esc_html_e('Books per user per day', 'nobleread-core'); ?></label>
                    </th>
                    <td>
                        <input type="number" min="1" id="nr_download_limit_per_day" name="nr_download_limit_per_day" value="<?php echo esc_attr(get_option('nr_download_limit_per_day', 5)); ?>">
                        <p class="description"><?php esc_html_e('How many distinct books a logged-in reader may start within a rolling 24-hour period. Once a book is started, all of its parts and formats are free — the cap is on volume of books, not on files or network bandwidth.', 'nobleread-core'); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">
                        <label for="nr_unlock_delay_hours"><?php esc_html_e('Default unlock delay (hours)', 'nobleread-core'); ?></label>
                    </th>
                    <td>
                        <input type="number" min="0" id="nr_unlock_delay_hours" name="nr_unlock_delay_hours" value="<?php echo esc_attr(get_option('nr_unlock_delay_hours', 72)); ?>">
                        <p class="description"><?php esc_html_e('For books released in stages: how long after a reader starts one part the next one opens, roughly the time needed to read it. 72 = three days. Individual parts can override this.', 'nobleread-core'); ?></p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}
