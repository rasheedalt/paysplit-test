import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { ApiError, errorHandler } from './middleware/errorHandler.js';
import v1Routes from './routes/v1Routes.js';
import webhookRoutes from './routes/webhookRoutes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/openapi.json', (_req, res) => {
    res.type('json').send(readFileSync(path.resolve(process.cwd(), 'openapi.json')));
  });
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      customSiteTitle: 'PaySplit API docs',
      swaggerOptions: { url: '/openapi.json' },
    })
  );

  app.use('/v1/webhooks', webhookRoutes);
  app.use(express.json({ limit: '64kb', strict: true }));

  app.use('/v1', v1Routes);
  app.use((_req, _res, next) => next(new ApiError(404, 'Route not found')));

  app.use(errorHandler);
  return app;
}
