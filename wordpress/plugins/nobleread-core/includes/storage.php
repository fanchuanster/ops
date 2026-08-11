<?php
/**
 * R2 (Cloudflare's S3-compatible object storage) for part-level book
 * artifacts — the DOCX/EPUB/PDF fields tracked in
 * nr_part_format_fields() (meta-boxes.php), matching the "books/"
 * structure CLAUDE.md section 14 sketches for S3-compatible storage.
 *
 * Deliberately narrow scope: generic WordPress media (theme images, the
 * book cover/featured image) is untouched and stays on local disk — this
 * file only mirrors the specific attachments the plugin's own format
 * fields point at.
 *
 * The local WordPress media library remains how a file gets attached in
 * the first place (admin picks it via the normal media uploader in
 * meta-boxes.php); this file's job is to mirror that file out to R2 once
 * it's attached (nr_storage_sync_to_r2(), called from
 * nr_save_part_meta()) and to be the single place that decides whether a
 * given part+format is served from R2 or from the local file
 * (nr_storage_resolve(), used by includes/access.php's
 * nr_part_file_path()). Falls back to local automatically whenever R2
 * isn't configured, so local dev works without an R2 account.
 *
 * See docs/ARCHITECTURE_REVIEW.md section 4 and docs/ROADMAP.md for the
 * decision record, and `wp nr backfill-storage` (includes/cli.php) for
 * migrating files that were attached before R2 was configured.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** True once real R2 credentials are configured via environment variables. */
function nr_storage_r2_configured() {
    return (bool) (nr_env('CLOUDFLARE_S3_ENDPOINTS')
        && nr_env('CLOUDFLARE_S3_ACCESS_KEY_ID')
        && nr_env('CLOUDFLARE_S3_SECRET_ACCESS_KEY'));
}

function nr_storage_bucket() {
    return nr_env('NR_R2_BUCKET', 'nobleread');
}

/**
 * Lazily built, request-cached S3Client pointed at R2. Only call this
 * once nr_storage_r2_configured() is true — it doesn't check itself, so
 * callers get a clear "class not found" rather than a silent no-op if
 * they get the order wrong.
 */
function nr_r2_client() {
    static $client = null;
    if (null !== $client) {
        return $client;
    }

    require_once NR_PLUGIN_DIR . 'vendor/autoload.php';

    $client = new \Aws\S3\S3Client([
        'version' => 'latest',
        // R2 has no AWS-style regions; 'auto' is Cloudflare's documented
        // value for the S3-compatible API.
        'region' => 'auto',
        'endpoint' => nr_env('CLOUDFLARE_S3_ENDPOINTS'),
        'use_path_style_endpoint' => true,
        'credentials' => [
            'key' => nr_env('CLOUDFLARE_S3_ACCESS_KEY_ID'),
            'secret' => nr_env('CLOUDFLARE_S3_SECRET_ACCESS_KEY'),
        ],
    ]);
    // Lets includes/access.php's nr_stream_file() read an R2 object the
    // same way it reads a local file — fopen()/readfile() against an
    // "s3://bucket/key" URI — instead of every caller needing its own
    // GetObject/streaming logic.
    $client->registerStreamWrapper();

    return $client;
}

/**
 * The R2 object key for a given part+format, per CLAUDE.md section 14's
 * suggested books/{book_id}/parts/{part_id}/... layout.
 */
function nr_storage_object_key($book_id, $part_id, $meta_key) {
    $names = [
        'nr_docx_attachment_id' => 'master.docx',
        'nr_epub_attachment_id' => 'book.epub',
        'nr_pdf_standard_attachment_id' => 'standard.pdf',
        'nr_pdf_large_attachment_id' => 'large.pdf',
        'nr_pdf_xl_attachment_id' => 'xl.pdf',
    ];
    $name = $names[$meta_key] ?? $meta_key;
    return sprintf('books/%d/parts/%d/%s', $book_id, $part_id, $name);
}

/** Postmeta key an attachment's R2 object key is recorded under, once mirrored. */
function nr_storage_r2_key_meta($meta_key) {
    return $meta_key . '_r2_key';
}

/**
 * Upload a part-format attachment's local file to R2 and record its
 * object key. No-op (returns false) if R2 isn't configured, the field
 * has no attachment, the local file is missing, or the part has no
 * parent book yet (the object key needs a book id).
 *
 * Safe to call unconditionally on every part save: same key each time,
 * so a re-upload of an unchanged file just overwrites itself. Clears the
 * recorded R2 key when a field's attachment is removed, so
 * nr_storage_resolve() doesn't keep pointing at a stale object.
 */
function nr_storage_sync_to_r2($part_id, $meta_key) {
    if (!nr_storage_r2_configured()) {
        return false;
    }

    $attachment_id = (int) get_post_meta($part_id, $meta_key, true);
    if (!$attachment_id) {
        delete_post_meta($part_id, nr_storage_r2_key_meta($meta_key));
        return false;
    }

    $file = get_attached_file($attachment_id);
    if (!$file || !file_exists($file)) {
        return false;
    }

    $part = get_post($part_id);
    $book_id = $part ? (int) $part->post_parent : 0;
    if (!$book_id) {
        return false;
    }

    $key = nr_storage_object_key($book_id, $part_id, $meta_key);
    $mime = wp_check_filetype($file);

    try {
        nr_r2_client()->putObject([
            'Bucket' => nr_storage_bucket(),
            'Key' => $key,
            'SourceFile' => $file,
            'ContentType' => $mime['type'] ?: 'application/octet-stream',
        ]);
    } catch (\Throwable $e) {
        error_log(sprintf(
            'NobleRead: R2 upload failed for part %d field %s: %s',
            $part_id,
            $meta_key,
            $e->getMessage()
        ));
        return false;
    }

    update_post_meta($part_id, nr_storage_r2_key_meta($meta_key), $key);
    return true;
}

/**
 * Resolve a part+format to a readable source: a local absolute path, an
 * "s3://bucket/key" stream-wrapper URI (works transparently with
 * file_exists()/filesize()/readfile() once nr_r2_client() has registered
 * the wrapper), or false if it's available from neither.
 *
 * Prefers R2 once a part+format has been mirrored there; local stays the
 * fallback for anything not yet migrated (see `wp nr backfill-storage`)
 * and for local dev without R2 configured at all — so this one function
 * is the only thing that needs to know storage is split across two
 * backends during the migration.
 */
function nr_storage_resolve($part_id, $meta_key) {
    $r2_key = get_post_meta($part_id, nr_storage_r2_key_meta($meta_key), true);
    if ($r2_key && nr_storage_r2_configured()) {
        if (nr_r2_client()->doesObjectExist(nr_storage_bucket(), $r2_key)) {
            return 's3://' . nr_storage_bucket() . '/' . $r2_key;
        }
        // Recorded a key but the object's gone (bucket cleaned up out of
        // band, etc.) — fall through to local rather than fail closed on
        // a storage inconsistency the reader had no part in.
    }

    $attachment_id = (int) get_post_meta($part_id, $meta_key, true);
    if (!$attachment_id) {
        return false;
    }
    $file = get_attached_file($attachment_id);
    return ($file && file_exists($file)) ? $file : false;
}
