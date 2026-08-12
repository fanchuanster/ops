import * as migration_20260812_173713_initial from './20260812_173713_initial';
import * as migration_20260812_194242_add_book_slug from './20260812_194242_add_book_slug';
import * as migration_20260812_204515_add_downloads_and_progress from './20260812_204515_add_downloads_and_progress';

export const migrations = [
  {
    up: migration_20260812_173713_initial.up,
    down: migration_20260812_173713_initial.down,
    name: '20260812_173713_initial',
  },
  {
    up: migration_20260812_194242_add_book_slug.up,
    down: migration_20260812_194242_add_book_slug.down,
    name: '20260812_194242_add_book_slug',
  },
  {
    up: migration_20260812_204515_add_downloads_and_progress.up,
    down: migration_20260812_204515_add_downloads_and_progress.down,
    name: '20260812_204515_add_downloads_and_progress'
  },
];
