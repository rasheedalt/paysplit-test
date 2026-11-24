import express, { Router } from 'express';
import { salaryController } from '../controllers/salaryController.js';

const router = Router();
router.post('/salary', express.raw({ type: 'application/json', limit: '64kb' }), salaryController().webhook);

export default router;
