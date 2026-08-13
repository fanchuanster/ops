import * as migration_20260812_222402_initial from './20260812_222402_initial';
import * as migration_20260813_024651_add_kindle_email from './20260813_024651_add_kindle_email';

export const migrations = [
  {
    up: migration_20260812_222402_initial.up,
    down: migration_20260812_222402_initial.down,
    name: '20260812_222402_initial',
  },
  {
    up: migration_20260813_024651_add_kindle_email.up,
    down: migration_20260813_024651_add_kindle_email.down,
    name: '20260813_024651_add_kindle_email'
  },
];
