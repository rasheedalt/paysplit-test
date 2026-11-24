import express, { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { salaryController } from '../controllers/salaryController.js';

export function webhookRoutes(db: DatabaseSync) {
  const router = Router();
  router.post('/salary', express.raw({ type: 'application/json', limit: '64kb' }), salaryController(db).webhook);
  return router;
}
