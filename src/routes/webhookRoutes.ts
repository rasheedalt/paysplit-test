import express, { Router } from 'express';
import { salaryController } from '../controllers/salaryController.js';

const webhookRouter = Router();
webhookRouter.post(
  '/salary',
  express.raw({ type: 'application/json', limit: '64kb' }),
  salaryController.webhook
);

export default webhookRouter;
