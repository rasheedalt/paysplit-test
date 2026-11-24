export const env = {
  databasePath: process.env.PAYSPLIT_DB ?? 'paysplit.db',
  get webhookSecret() { return process.env.PAYSPLIT_WEBHOOK_SECRET ?? ''; },
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? '8000'),
  embeddedWorker: process.env.PAYSPLIT_EMBEDDED_WORKER === '1',
};
