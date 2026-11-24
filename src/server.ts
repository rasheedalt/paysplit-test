import { createApp } from './app.js';
import { env } from './config/env.js';
import { createPrismaClient } from './database/prisma.js';
import { runPayoutJob } from './jobs/payoutJob.js';

const prisma = createPrismaClient();
if (env.embeddedWorker) {
  const run = async () => {
    try { await runPayoutJob(prisma); } catch (error) { console.error('Payout worker failed', error); }
  };
  void run();
  setInterval(() => void run(), 60_000);
}
createApp(prisma).listen(env.port, env.host, () => console.log(`PaySplit listening on ${env.host}:${env.port}`));
