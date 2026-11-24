import { createApp } from './app.js';
import { env } from './config/env.js';
import { openDatabase } from './database/sqlite.js';
import { runPayoutJob } from './jobs/payoutJob.js';

const db = openDatabase();
if (env.embeddedWorker) {
  const run = () => {
    try { runPayoutJob(db); } catch (error) { console.error('Payout worker failed', error); }
  };
  run();
  setInterval(run, 60_000);
}
createApp(db).listen(env.port, env.host, () => console.log(`PaySplit listening on ${env.host}:${env.port}`));
