import * as migration_20260812_173713_initial from './20260812_173713_initial';

export const migrations = [
  {
    up: migration_20260812_173713_initial.up,
    down: migration_20260812_173713_initial.down,
    name: '20260812_173713_initial'
  },
];
