<?php
/**
 * Per-user download rate limiting.
 *
 * A logged-in reader may download a limited number of book parts within
 * a rolling 24-hour period (default 5, configurable under
 * Settings > NobleRead). This limits volume of books downloaded, not
 * network bandwidth/throughput.
 *
 * Backed by a small append-only log table (not usermeta) so the check is
 * a real rolling-window COUNT(*) and the log doubles as an audit trail
 * for abuse investigation later. See docs/ARCHITECTURE_REVIEW.md.
 */

if (!defined('ABSPATH')) {
    exit;
}

class NR_Download_Limiter {

    public static function table_name() {
        global $wpdb;
        return $wpdb->prefix . 'nr_downloads';
    }

    public static function create_table() {
        global $wpdb;
        $table = self::table_name();
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            part_id BIGINT UNSIGNED NOT NULL,
            book_id BIGINT UNSIGNED NOT NULL,
            format VARCHAR(32) NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY user_created (user_id, created_at),
            KEY user_book_created (user_id, book_id, created_at)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }

    public static function limit_per_day() {
        return max(1, (int) get_option('nr_download_limit_per_day', 5));
    }

    protected static function window_start() {
        return gmdate('Y-m-d H:i:s', time() - DAY_IN_SECONDS);
    }

    /**
     * Distinct books the user has drawn from during the window. The limit
     * is on volume of BOOKS (CLAUDE.md section 6 / core feature 6), so
     * taking one title as EPUB and again as PDF — or reading several parts
     * of it — costs one unit, not one per file.
     */
    public static function count_books_since($user_id, $since) {
        global $wpdb;
        $table = self::table_name();
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(DISTINCT book_id) FROM {$table} WHERE user_id = %d AND created_at >= %s",
            $user_id,
            $since
        ));
    }

    public static function has_downloaded_book($user_id, $book_id, $since) {
        global $wpdb;
        $table = self::table_name();
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT 1 FROM {$table} WHERE user_id = %d AND book_id = %d AND created_at >= %s LIMIT 1",
            $user_id,
            $book_id,
            $since
        ));
    }

    /**
     * A book already drawn from during this window never re-charges, so
     * a reader is never punished for wanting a different format or the
     * next part of something they're already reading.
     */
    public static function under_limit($user_id, $book_id = 0) {
        $since = self::window_start();
        if ($book_id && self::has_downloaded_book($user_id, $book_id, $since)) {
            return true;
        }
        return self::count_books_since($user_id, $since) < self::limit_per_day();
    }

    /** Whether starting this book would consume one of the day's slots. */
    public static function counts_against_limit($user_id, $book_id) {
        return !self::has_downloaded_book($user_id, $book_id, self::window_start());
    }

    public static function remaining($user_id) {
        return max(0, self::limit_per_day() - self::count_books_since($user_id, self::window_start()));
    }

    /**
     * When this reader first took anything from this part, as a UTC
     * timestamp, or null. Deliberately spans all history rather than the
     * rate-limit window — the staged-release clock is unrelated to it.
     */
    public static function first_download_at($user_id, $part_id) {
        global $wpdb;
        $table = self::table_name();
        $when = $wpdb->get_var($wpdb->prepare(
            "SELECT MIN(created_at) FROM {$table} WHERE user_id = %d AND part_id = %d",
            $user_id,
            $part_id
        ));
        return $when ? strtotime($when . ' UTC') : null;
    }

    public static function record($user_id, $part_id, $book_id, $format) {
        global $wpdb;
        $wpdb->insert(
            self::table_name(),
            [
                'user_id' => $user_id,
                'part_id' => $part_id,
                'book_id' => $book_id,
                'format' => $format,
                'created_at' => gmdate('Y-m-d H:i:s'),
            ],
            ['%d', '%d', '%d', '%s', '%s']
        );
    }
}
