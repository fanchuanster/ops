import * as migration_20260812_222402_initial from './20260812_222402_initial';

export const migrations = [
  {
    up: migration_20260812_222402_initial.up,
    down: migration_20260812_222402_initial.down,
    name: '20260812_222402_initial'
  },
];
