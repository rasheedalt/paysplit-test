import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { salaryController } from '../controllers/salaryController.js';

export function webhookRoutes(db: PrismaClient) {
  const router = Router();
  router.post('/salary', express.raw({ type: 'application/json', limit: '64kb' }), salaryController(db).webhook);
  return router;
}
