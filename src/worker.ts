import { prisma } from './database/prisma.js';
import { runPayoutJob } from './jobs/payoutJob.js';

const once = process.argv.includes('--once');
const run = async () => {
  try { console.log(`Processed ${await runPayoutJob()} allocations`); }
  catch (error) { console.error(error); process.exitCode = 1; }
};
void run().then(async () => { if (once) await prisma.$disconnect(); });
if (!once) setInterval(() => void run(), 60_000);
