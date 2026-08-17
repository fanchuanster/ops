import * as migration_20260812_222402_initial from './20260812_222402_initial';
import * as migration_20260813_024651_add_kindle_email from './20260813_024651_add_kindle_email';
import * as migration_20260813_183717_add_book_level_and_review from './20260813_183717_add_book_level_and_review';
import * as migration_20260813_191556_add_google_id from './20260813_191556_add_google_id';
import * as migration_20260814_025455_add_avatar_url from './20260814_025455_add_avatar_url';
import * as migration_20260814_050000_books_credits_and_uploads from './20260814_050000_books_credits_and_uploads';
import * as migration_20260814_150000_upload_quota from './20260814_150000_upload_quota';
import * as migration_20260814_155000_uploader_share from './20260814_155000_uploader_share';
import * as migration_20260814_182000_cascade_book_deletes from './20260814_182000_cascade_book_deletes';
import * as migration_20260815_051500_ocr_pipeline from './20260815_051500_ocr_pipeline';
import * as migration_20260815_060000_pending_formats from './20260815_060000_pending_formats';
import * as migration_20260815_150000_source_hash from './20260815_150000_source_hash';

export const migrations = [
  {
    up: migration_20260812_222402_initial.up,
    down: migration_20260812_222402_initial.down,
    name: '20260812_222402_initial',
  },
  {
    up: migration_20260813_024651_add_kindle_email.up,
    down: migration_20260813_024651_add_kindle_email.down,
    name: '20260813_024651_add_kindle_email',
  },
  {
    up: migration_20260813_183717_add_book_level_and_review.up,
    down: migration_20260813_183717_add_book_level_and_review.down,
    name: '20260813_183717_add_book_level_and_review',
  },
  {
    up: migration_20260813_191556_add_google_id.up,
    down: migration_20260813_191556_add_google_id.down,
    name: '20260813_191556_add_google_id',
  },
  {
    up: migration_20260814_025455_add_avatar_url.up,
    down: migration_20260814_025455_add_avatar_url.down,
    name: '20260814_025455_add_avatar_url'
  },
  {
    up: migration_20260814_050000_books_credits_and_uploads.up,
    down: migration_20260814_050000_books_credits_and_uploads.down,
    name: '20260814_050000_books_credits_and_uploads'
  },
  {
    up: migration_20260814_150000_upload_quota.up,
    down: migration_20260814_150000_upload_quota.down,
    name: '20260814_150000_upload_quota'
  },
  {
    up: migration_20260814_155000_uploader_share.up,
    down: migration_20260814_155000_uploader_share.down,
    name: '20260814_155000_uploader_share'
  },
  {
    up: migration_20260814_182000_cascade_book_deletes.up,
    down: migration_20260814_182000_cascade_book_deletes.down,
    name: '20260814_182000_cascade_book_deletes'
  },
  {
    up: migration_20260815_051500_ocr_pipeline.up,
    down: migration_20260815_051500_ocr_pipeline.down,
    name: '20260815_051500_ocr_pipeline'
  },
  {
    up: migration_20260815_060000_pending_formats.up,
    down: migration_20260815_060000_pending_formats.down,
    name: '20260815_060000_pending_formats'
  },
  {
    up: migration_20260815_150000_source_hash.up,
    down: migration_20260815_150000_source_hash.down,
    name: '20260815_150000_source_hash'
  },
];
