import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { accountController } from '../controllers/accountController.js';
import { destinationController } from '../controllers/destinationController.js';
import { ruleController } from '../controllers/ruleController.js';
import { salaryController } from '../controllers/salaryController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export function v1Routes(db: PrismaClient) {
  const router = Router();
  const account = accountController(db);
  const destinations = destinationController(db);
  const rules = ruleController(db);
  const salary = salaryController(db);


  router.post('/users', account.register);
  router.post('/sessions', account.login);
  router.use(authMiddleware(db));
  router.get('/me', account.me);
  router.post('/destinations', destinations.create);
  router.get('/destinations', destinations.list);
  router.post('/rules', rules.create);
  router.get('/rules', rules.list);
  router.delete('/rules/:id', rules.deactivate);
  router.get('/salary-events', salary.list);
  router.get('/salary-events/:id', salary.get);
  router.get('/ledger', salary.ledger);
  return router;
}
