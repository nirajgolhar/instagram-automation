import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import webhookRoutes from './routes/webhook.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, '../downloads')));
app.use('/webhook', webhookRoutes);

export default app;