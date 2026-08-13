import * as migration_20260812_222402_initial from './20260812_222402_initial';
import * as migration_20260813_024651_add_kindle_email from './20260813_024651_add_kindle_email';
import * as migration_20260813_183717_add_book_level_and_review from './20260813_183717_add_book_level_and_review';
import * as migration_20260813_191556_add_google_id from './20260813_191556_add_google_id';

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
    name: '20260813_191556_add_google_id'
  },
];
