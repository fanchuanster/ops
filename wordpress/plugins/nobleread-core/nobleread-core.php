<?php
/**
 * Plugin Name: NobleRead Core
 * Plugin URI:  https://nobelread.com
 * Description: Book/Part content model, rights-status gating, per-format
 *              downloads, and per-user download rate limiting for
 *              NobleRead. Business logic only — presentation belongs to
 *              the active theme. See CLAUDE.md and docs/ROADMAP.md.
 * Version:     0.1.0
 * Author:      NobleRead
 * License:     GPL-2.0-or-later
 * Text Domain: nobleread-core
 */

if (!defined('ABSPATH')) {
    exit;
}

define('NR_PLUGIN_FILE', __FILE__);
define('NR_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('NR_PLUGIN_URL', plugin_dir_url(__FILE__));
define('NR_VERSION', '0.1.0');

require_once NR_PLUGIN_DIR . 'includes/post-types.php';
require_once NR_PLUGIN_DIR . 'includes/meta-boxes.php';
require_once NR_PLUGIN_DIR . 'includes/rate-limit.php';
require_once NR_PLUGIN_DIR . 'includes/downloads.php';
require_once NR_PLUGIN_DIR . 'includes/templates.php';
require_once NR_PLUGIN_DIR . 'includes/settings.php';
require_once NR_PLUGIN_DIR . 'includes/activation.php';

register_activation_hook(NR_PLUGIN_FILE, 'nr_activate_plugin');
register_deactivation_hook(NR_PLUGIN_FILE, 'nr_deactivate_plugin');
