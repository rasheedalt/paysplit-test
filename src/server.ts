import { createApp } from './app.js';
import { openDatabase, processPending } from './core.js';

const db = openDatabase();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '8000');
if (process.env.PAYSPLIT_EMBEDDED_WORKER === '1') {
  const run = () => {
    try { processPending(db); } catch (error) { console.error('Payout worker failed', error); }
  };
  run();
  setInterval(run, 60_000);
}
createApp(db).listen(port, host, () => console.log(`PaySplit listening on ${host}:${port}`));
