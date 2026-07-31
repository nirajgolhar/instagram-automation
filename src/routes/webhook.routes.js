import express from 'express';
import {
  verifyWebhook,
  handleWebhook
} from '../controllers/webhook.controller.js';

const router = express.Router();

router.use((req, _res, next) => {
  console.log(`📬 ${req.method} /webhook`, JSON.stringify(req.headers['x-hub-signature-256'] || 'no-sig'));
  next();
});

router.get('/', verifyWebhook);
router.post('/', handleWebhook);

export default router;