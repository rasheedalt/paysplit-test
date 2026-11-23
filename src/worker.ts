import { openDatabase, processPending } from './core.js';

const db = openDatabase();
const once = process.argv.includes('--once');
const run = () => {
  try { console.log(`Processed ${processPending(db)} allocations`); }
  catch (error) { console.error(error); process.exitCode = 1; }
};
run();
if (!once) setInterval(run, 60_000);
