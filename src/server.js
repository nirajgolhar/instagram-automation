import app from "./app.js";
import { config } from "./config/env.js";
import ngrok from "@ngrok/ngrok";

export let PUBLIC_URL = null;

async function start() {
  const server = app.listen(config.port, () => {
    console.log(`🚀 Local server: http://localhost:${config.port}`);
  });

  await ngrok.kill();

  const listener = await ngrok.connect({
    addr: config.port,
    authtoken: config.ngrokToken,
    domain: "zonular-ardently-marcellus.ngrok-free.dev",
  });

  PUBLIC_URL = listener.url();

  console.log(`🌍 Public URL: ${PUBLIC_URL}`);
  console.log(`👉 Webhook URL: ${PUBLIC_URL}/webhook`);
}

start();
