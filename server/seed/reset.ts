import { rmSync, existsSync } from 'node:fs';
import { DEFAULT_DB_PATH } from '../lib/db.ts';

const target = process.env.MATHREALMS_DB || DEFAULT_DB_PATH;
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${target}${suffix}`;
  if (existsSync(file)) rmSync(file);
}
console.log(`Removed ${target}`);
