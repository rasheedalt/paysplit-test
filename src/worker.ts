import { openDatabase } from './database/sqlite.js';
import { runPayoutJob } from './jobs/payoutJob.js';

const db = openDatabase();
const once = process.argv.includes('--once');
const run = () => {
  try { console.log(`Processed ${runPayoutJob(db)} allocations`); }
  catch (error) { console.error(error); process.exitCode = 1; }
};
run();
if (!once) setInterval(run, 60_000);
