import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import webhookRoutes from './routes/webhook.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, '../downloads')));
app.use('/webhook', webhookRoutes);

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Instagram Automation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 90%;
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #e1306c, #fd1d1d, #fcb045);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: #888;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 13px;
      color: #aaa;
      margin: 6px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🤖</div>
    <h1>Instagram Automation</h1>
    <p>Webhook server is running and listening for Instagram events.</p>
    <div>
      <span class="badge"><span class="dot"></span> Server online</span>
      <span class="badge">📡 /webhook active</span>
      <span class="badge">🎬 /videos served</span>
    </div>
  </div>
</body>
</html>`);
});

export default app;