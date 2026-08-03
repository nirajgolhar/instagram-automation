import app from "./app.js";
import { config } from "./config/env.js";

export let PUBLIC_URL = config.publicUrl || null;

async function start() {
  app.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
  });

  // Use ngrok only in local dev when NGROK_AUTH_TOKEN is set
  if (config.ngrokToken) {
    const { default: ngrok } = await import("@ngrok/ngrok");
    await ngrok.kill();
    const listener = await ngrok.connect({
      addr: config.port,
      authtoken: config.ngrokToken,
      domain: "zonular-ardently-marcellus.ngrok-free.dev",
    });
    PUBLIC_URL = listener.url();
  }

  console.log(`🌍 Public URL: ${PUBLIC_URL}`);
  console.log(`👉 Webhook URL: ${PUBLIC_URL}/webhook`);
  console.log(`🧪 Test URL: ${PUBLIC_URL}/test-log`);
}

start();
