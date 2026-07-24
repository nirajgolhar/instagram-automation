import { config } from "../config/env.js";
import { downloadInstagramVideo } from "../services/downloader.service.js";

const processedMessages = new Set();

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.verifyToken) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
};

export const handleWebhook = async (req, res) => {
  try {
    const messaging = req.body.entry?.[0]?.messaging?.[0];

    if (!messaging?.message) {
      return res.sendStatus(200);
    }

    const messageId = messaging.message.mid;

    // 🚨 Ignore duplicates
    if (processedMessages.has(messageId)) {
      console.log("⚠️ Duplicate webhook ignored:", messageId);
      return res.sendStatus(200);
    }

    // ✅ Mark as processed
    processedMessages.add(messageId);

    // ✅ Auto-clean after 60 seconds (ADD IT HERE 👇)
    setTimeout(() => {
      processedMessages.delete(messageId);
    }, 60000);

    // ✅ Respond immediately to Meta
    res.sendStatus(200);

    // ✅ Process in background
    processMessage(messaging);
  } catch (err) {
    console.error(err);
    return res.sendStatus(200);
  }
};

async function processMessage(messaging) {
  try {
    const message = messaging.message;

    if (message.attachments?.length) {
      for (const attachment of message.attachments) {
        if (attachment.type === "ig_reel") {
          const videoUrl = attachment.payload.url;
          const caption = attachment.payload.title || "🔥 Auto uploaded reel";

          console.log("🎬 Reel received");
          console.log("📝 Caption:", caption);

          await downloadInstagramVideo(videoUrl, caption);
        }
      }
    }
  } catch (err) {
    console.error("Processing error:", err.message);
  }
}

// export const handleWebhook = async (req, res) => {
//   try {
//     const messaging = req.body.entry?.[0]?.messaging?.[0];

//     if (!messaging?.message) {
//       return res.sendStatus(200);
//     }

//     // 🚨 Ignore messages sent by your own page
//     if (messaging.sender?.id === config.igUserId) {
//       console.log("Ignored");
//       return res.sendStatus(200);
//     }

//     // 🚨 Ignore delivery / read events
//     if (!messaging.message.text && !messaging.message.attachments) {
//       return res.sendStatus(200);
//     }

//     console.log("📩 Valid incoming message:");

//     if (!messaging?.message) {
//       return res.sendStatus(200);
//     }

//     console.log("🔥 FULL WEBHOOK:", JSON.stringify(messaging, null, 2));

//     const message = messaging.message;

//     // 1️⃣ Handle Text Messages
//     if (message.text) {
//       console.log("📩 Text received:", message.text);

//       const urls = message.text.match(/https?:\/\/[^\s]+/gi);

//       if (urls?.length) {
//         for (const url of urls) {
//           await downloadInstagramVideo(url);
//         }
//       }
//     }

//     // 2️⃣ Handle Attachments (Reels, Posts, Media)
//     if (message.attachments?.length) {
//       for (const attachment of message.attachments) {
//         console.log("📎 Attachment:", attachment);

//         // If user shared a reel/post link
//         if (attachment.payload?.url) {
//           const mediaUrl = attachment.payload.url;
//           console.log("🔗 Attachment URL:", mediaUrl);

//           await downloadInstagramVideo(mediaUrl);
//         }

//         // If it's a shared Instagram post
//         if (attachment.payload?.id) {
//           console.log("🆔 Shared Media ID:", attachment.payload.id);

//           const mediaUrl = `https://www.instagram.com/reel/${attachment.payload.id}/`;
//           await downloadInstagramVideo(mediaUrl);
//         }
//       }
//     }

//     return res.sendStatus(200);
//   } catch (error) {
//     console.error("❌ Webhook Error:", error);
//     return res.sendStatus(200);
//   }
// };
