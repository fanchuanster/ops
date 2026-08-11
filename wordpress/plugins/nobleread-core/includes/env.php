<?php
/**
 * Shared environment-variable accessor for infrastructure credentials
 * (R2 storage, OAuth client secrets, ...). getenv() rather than a
 * WordPress option deliberately, across every caller: these are
 * deployment secrets, not site content, so they belong in the
 * environment (.env / docker-compose.yml), not the database, and must
 * never be editable from wp-admin.
 */

if (!defined('ABSPATH')) {
    exit;
}

function nr_env($key, $default = '') {
    $value = getenv($key);
    return (false === $value || '' === $value) ? $default : $value;
}
