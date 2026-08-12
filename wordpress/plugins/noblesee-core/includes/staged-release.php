<?php
/**
 * Staged / part-based release (CLAUDE.md core feature 4, delay half).
 *
 * Later parts of a book stay closed until the reader has actually started
 * the part before them, plus a delay roughly matching how long that part
 * takes to read. The clock is therefore **per reader**, started by their
 * own first download of the previous part — not a global publication
 * schedule. A global schedule would punish someone who discovers a book
 * late and reward nobody; the point is to pace one person's reading.
 *
 * Opt-in per book (`nr_staged_release`), so single-part titles and
 * anything that should simply be available are unaffected.
 *
 * The paid early-unlock half of the feature is deliberately NOT here —
 * it needs WooCommerce and is tracked in docs/ROADMAP.md.
 */

if (!defined('ABSPATH')) {
    exit;
}

class NR_Staged_Release {

    public static function is_enabled($book_id) {
        return '1' === (string) get_post_meta($book_id, 'nr_staged_release', true);
    }

    public static function default_delay_hours() {
        return max(0, (int) get_option('nr_unlock_delay_hours', 72));
    }

    /** Per-part override, falling back to the site-wide default. */
    public static function delay_hours($part_id) {
        $override = get_post_meta($part_id, 'nr_unlock_delay_hours', true);
        if ('' !== $override && null !== $override) {
            return max(0, (int) $override);
        }
        return self::default_delay_hours();
    }

    /** The part immediately before this one in reading order, if any. */
    public static function previous_part($part_id) {
        $part = get_post($part_id);
        if (!$part) {
            return null;
        }
        $previous = null;
        foreach (nr_get_book_parts((int) $part->post_parent) as $sibling) {
            if ((int) $sibling->ID === (int) $part_id) {
                return $previous;
            }
            $previous = $sibling;
        }
        return null;
    }

    /**
     * @return array{unlocked:bool, reason:string, unlocks_at:?int, previous_part_id:?int}
     *         reason is '' when unlocked, otherwise 'previous_not_started'
     *         or 'waiting'.
     */
    public static function status($part_id, $user_id) {
        $open = [
            'unlocked' => true,
            'reason' => '',
            'unlocks_at' => null,
            'previous_part_id' => null,
        ];

        $part = get_post($part_id);
        $book_id = $part ? (int) $part->post_parent : 0;

        if (!$book_id || !self::is_enabled($book_id)) {
            return $open;
        }

        // Editors need to be able to check a late part's files without
        // waiting out the delay first.
        if ($user_id && user_can($user_id, 'edit_post', $book_id)) {
            return $open;
        }

        $previous = self::previous_part($part_id);
        if (!$previous) {
            return $open; // The opening part is always available.
        }

        $locked = [
            'unlocked' => false,
            'reason' => 'previous_not_started',
            'unlocks_at' => null,
            'previous_part_id' => (int) $previous->ID,
        ];

        if (!$user_id) {
            return $locked;
        }

        $started_at = NR_Download_Limiter::first_download_at($user_id, $previous->ID);
        if (!$started_at) {
            return $locked;
        }

        $unlocks_at = $started_at + (self::delay_hours($part_id) * HOUR_IN_SECONDS);
        if (time() >= $unlocks_at) {
            return $open;
        }

        $locked['reason'] = 'waiting';
        $locked['unlocks_at'] = $unlocks_at;
        return $locked;
    }

    /** Reader-facing explanation for a locked part. */
    public static function lock_message(array $status) {
        if ('waiting' === $status['reason'] && $status['unlocks_at']) {
            return sprintf(
                /* translators: %s: human-readable time remaining, e.g. "2 days" */
                __('Opens in %s — time enough to enjoy the part you already have.', 'noblesee-core'),
                human_time_diff(time(), $status['unlocks_at'])
            );
        }

        $previous_title = $status['previous_part_id']
            ? get_the_title($status['previous_part_id'])
            : '';

        if ($previous_title) {
            return sprintf(
                /* translators: %s: title of the preceding part */
                __('Opens once you begin “%s”.', 'noblesee-core'),
                $previous_title
            );
        }

        return __('Opens once you begin the previous part.', 'noblesee-core');
    }
}
