import { Router } from 'express';
import { accountController } from '../controllers/accountController.js';
import { destinationController } from '../controllers/destinationController.js';
import { ruleController } from '../controllers/ruleController.js';
import { salaryController } from '../controllers/salaryController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();
const account = accountController();
const destinations = destinationController();
const rules = ruleController();
const salary = salaryController();

router.post('/users', account.register);
router.post('/sessions', account.login);

router.use(authMiddleware());

router.get('/me', account.me);
router.post('/destinations', destinations.create);
router.get('/destinations', destinations.list);
router.post('/rules', rules.create);
router.get('/rules', rules.list);
router.delete('/rules/:id', rules.deactivate);
router.get('/salary-events', salary.list);
router.get('/salary-events/:id', salary.get);
router.get('/ledger', salary.ledger);

export default router;
