import fetch from "node-fetch";
import { config } from "../config/env.js";

const GRAPH = "https://graph.facebook.com/v20.0";

async function waitForContainer(containerId) {
  for (let i = 0; i < 20; i++) {
    // retry up to ~60 seconds
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const statusRes = await fetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${config.pageAccessToken}`,
    );

    const statusData = await statusRes.json();

    console.log("📊 Status:", statusData);

    if (statusData.status_code === "FINISHED") {
      return true;
    }

    if (statusData.status_code === "ERROR") {
      throw new Error("Reel processing failed");
    }
  }

  throw new Error("Timed out waiting for reel processing");
}

import fs from "fs";

export async function uploadReel(videoUrl, caption, filePath) {
  try {
    console.log("🚀 Creating Reel container...");

    // 1️⃣ Create container
    const createRes = await fetch(`${GRAPH}/${config.igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption: caption || "🔥 Auto uploaded reel",
        access_token: config.pageAccessToken,
      }),
    });

    const createData = await createRes.json();
    console.log("📦 Container:", createData);

    if (!createData.id) {
      throw new Error("Container creation failed");
    }

    const containerId = createData.id;

    // 2️⃣ Wait properly
    await waitForContainer(containerId);

    console.log("✅ Reel ready. Publishing...");

    // 3️⃣ Publish
    const publishRes = await fetch(
      `${GRAPH}/${config.igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: config.pageAccessToken,
        }),
      },
    );

    const publishData = await publishRes.json();

    console.log("🎉 Published:", publishData);
    if (publishData?.id) {
      console.log("🎉 Published:", publishData);

      // 🗑 Delete local file after successful publish
      try {
        fs.unlinkSync(filePath);
        console.log("🗑 Local file deleted:", filePath);
      } catch (err) {
        console.error("⚠️ File delete failed:", err.message);
      }
    } else {
      console.log("❌ Publish failed:", publishData);
    }
  } catch (err) {
    console.error("❌ Upload error:", err.message);
  }
}
