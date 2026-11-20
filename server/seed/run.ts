import { openDatabase } from '../lib/db.ts';
import { seedDatabase } from './index.ts';

const db = openDatabase();
const started = Date.now();
const result = seedDatabase(db);
console.log(JSON.stringify({ ...result, ms: Date.now() - started }, null, 2));
db.close();
