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
import * as migration_20260819_100000_adobe_export from './20260819_100000_adobe_export';
import * as migration_20260820_120000_one_pdf_and_plans from './20260820_120000_one_pdf_and_plans';
import * as migration_20260821_140000_proposed_level from './20260821_140000_proposed_level';
import * as migration_20260821_170000_collection_order from './20260821_170000_collection_order';
import * as migration_20260823_120000_generated_cover from './20260823_120000_generated_cover';
import * as migration_20260824_060000_unique_title from './20260824_060000_unique_title';
import * as migration_20260824_090000_user_api_keys from './20260824_090000_user_api_keys';

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
  {
    up: migration_20260819_100000_adobe_export.up,
    down: migration_20260819_100000_adobe_export.down,
    name: '20260819_100000_adobe_export'
  },
  {
    up: migration_20260820_120000_one_pdf_and_plans.up,
    down: migration_20260820_120000_one_pdf_and_plans.down,
    name: '20260820_120000_one_pdf_and_plans'
  },
  {
    up: migration_20260821_140000_proposed_level.up,
    down: migration_20260821_140000_proposed_level.down,
    name: '20260821_140000_proposed_level'
  },
  {
    up: migration_20260821_170000_collection_order.up,
    down: migration_20260821_170000_collection_order.down,
    name: '20260821_170000_collection_order'
  },
  {
    up: migration_20260823_120000_generated_cover.up,
    down: migration_20260823_120000_generated_cover.down,
    name: '20260823_120000_generated_cover'
  },
  {
    up: migration_20260824_060000_unique_title.up,
    down: migration_20260824_060000_unique_title.down,
    name: '20260824_060000_unique_title'
  },
  {
    up: migration_20260824_090000_user_api_keys.up,
    down: migration_20260824_090000_user_api_keys.down,
    name: '20260824_090000_user_api_keys'
  },
];
