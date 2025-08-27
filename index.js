import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import chokidar from 'chokidar';
import fetch from 'node-fetch';
import ngrok from 'ngrok';
import { setTimeout as wait } from 'timers/promises';
import { fileURLToPath } from 'url';


const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ===================== ENV & CONSTANTS ===================== */
const PORT = Number(process.env.PORT || 3000);
const WATCH_FOLDER = process.env.WATCH_FOLDER || path.join(__dirname, 'downloads');
const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN;

const PAGE_ID = process.env.PAGE_ID;               // FB Page ID
const IG_USER_ID = process.env.IG_USER_ID;         // IG Business Account ID (connected to Page)
const ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN.trim();

const GRAPH = 'https://graph.facebook.com/v20.0';
const GRAPH_IG = 'https://graph.instagram.com/v23.0';
const DM_SENDER_USERNAME_TO_ALLOW = 'know_niraj';  // only process messages from this sender
const DM_POLL_INTERVAL_MS = 10 * 1000;               // 10 sec
const UPLOAD_COOLDOWN_MS = 60 * 60 * 1000;         // 1 hour cooldown after each upload

/* ===================== UTILITIES ===================== */

ensureDir(WATCH_FOLDER);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeBaseFilename(str, max = 80) {
  const s = (str || '').replace(/[^\w\d\-]+/g, '_').replace(/^_+|_+$/g, '');
  return s.slice(0, max) || `file_${Date.now()}`;
}

function extractInstagramUrls(text) {
  if (!text) return [];
  return [...text.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/[^\s)]+/gi)].map(m => m[0]);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return data;
}

/* ===================== SERVER + NGROK ===================== */

let publicBaseUrl = null;

async function startServer() {
  const app = express();
  app.use('/videos', express.static(WATCH_FOLDER));

  await new Promise(resolve => {
    app.listen(PORT, () => {
      console.log(`Local server on http://localhost:${PORT}`);
      resolve();
    });
  });

  publicBaseUrl = await ngrok.connect({
    addr: PORT,
    authtoken: NGROK_AUTH_TOKEN,
  });

  console.log(`Public video URL base: ${publicBaseUrl}/videos/`);
}

/* ===================== IG UPLOAD: WATCH FOLDER ===================== */

async function uploadReel(videoFile) {
  try {
    const publicVideoUrl = `${publicBaseUrl}/videos/${encodeURIComponent(videoFile)}`;
    const caption = generateCaption(videoFile);

    console.log(`Uploading Reel: ${videoFile}`);
    // 1) Create container
    const createUrl = `${GRAPH}/${IG_USER_ID}/media`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: publicVideoUrl,
        caption,
        media_type: 'REELS',
        access_token: ACCESS_TOKEN,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.id) {
      throw new Error(`Create failed: ${JSON.stringify(createData)}`);
    }
    const creationId = createData.id;
    console.log(`Media container created: ${creationId}`);

    // 2) Poll processing
    let status = 'IN_PROGRESS';
    while (status !== 'FINISHED') {
      const statusUrl = `${GRAPH}/${creationId}?fields=status_code&access_token=${ACCESS_TOKEN}`;
      const statusData = await fetchJson(statusUrl);
      status = statusData.status_code;
      console.log(`Processing status: ${status}`);
      if (status === 'ERROR') throw new Error('Video processing failed');
      if (status !== 'FINISHED') await wait(5000);
    }

    // 3) Publish
    const publishUrl = `${GRAPH}/${IG_USER_ID}/media_publish`;
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: ACCESS_TOKEN,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      throw new Error(`Publish failed: ${JSON.stringify(publishData)}`);
    }

    console.log(`✅ Reel published: ${publishData.id}`);

    // 4) Delete local file
    const fullPath = path.join(WATCH_FOLDER, videoFile);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`🧹 Deleted local file: ${videoFile}`);
    }
  } catch (err) {
    console.error(`❌ Error uploading reel: ${err.message}`);
  }
}

function generateCaption(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  return `🔥 ${baseName.replace(/_/g, ' ')} 🔥\n#reels #viral #fyp`;
}

function startFileWatcher() {
  const watcher = chokidar.watch(WATCH_FOLDER, { persistent: true, ignoreInitial: true });
  let isProcessing = false;

  watcher.on('add', async filePath => {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.mp4', '.mov', '.m4v'].includes(ext)) return;

    if (isProcessing) {
      console.log('⏳ Upload in cooldown; new file will be handled later.');
      return;
    }

    isProcessing = true;
    try {
      await uploadReel(path.basename(filePath));
      console.log(`⏸️ Cooldown ${UPLOAD_COOLDOWN_MS / 1000 / 60} minutes before next upload...`);
    } finally {
      await wait(UPLOAD_COOLDOWN_MS);
      isProcessing = false;
    }
  });

  console.log(`👀 Watching folder: ${WATCH_FOLDER}`);
}

/* ===================== IG MESSAGING POLLER ===================== */

let lastCheck = Date.now() - 5 * 60 * 1000; // look back 5 min on start
const processedMessageIds = new Set();

/**
 * List conversations for the Page with platform=instagram
 */
async function listIgConversations() {
  const url = `${GRAPH_IG}/me/conversations?platform=instagram&access_token=${INSTAGRAM_ACCESS_TOKEN}`;

  const response = await fetch(url);

  const data = await response.json();

  return data;
}

/**
 * Expand a conversation -> message IDs
 */
async function getConversationMessages(conversationId) {
  const url = `${GRAPH_IG}/${conversationId}?fields=messages&access_token=${INSTAGRAM_ACCESS_TOKEN}`;
  return await fetchJson(url);
}

/**
 * Fetch message details by message ID
 */
async function getMessage(messageId) {
  const url = `${GRAPH_IG}/${messageId}?fields=message,attachments,shares,created_time,from,to&access_token=${INSTAGRAM_ACCESS_TOKEN}`;
  return await fetchJson(url);
}

/**
 * Resolve an Instagram post/reel URL into downloadable media video URLs.
 * Uses instagram_oembed -> media_id, then media fields.
 * Returns an array of {url, filenameBase}
 */
async function resolveInstagramMediaUrls(instagramUrl) {
  // 1) oEmbed → media_id
  const oembedUrl = `${GRAPH_IG}/instagram_oembed?url=${encodeURIComponent(instagramUrl)}&access_token=${INSTAGRAM_ACCESS_TOKEN}`;
  const oembed = await fetchJson(oembedUrl);
  if (!oembed.media_id) throw new Error('No media_id from oEmbed');

  // 2) media info
  const fields = 'id,media_type,media_url,permalink,caption,children{media_type,media_url,id}';
  const mediaUrl = `${GRAPH_IG}/${oembed.media_id}?fields=${encodeURIComponent(fields)}&access_token=${INSTAGRAM_ACCESS_TOKEN}`;
  const media = await fetchJson(mediaUrl);

  const base = safeBaseFilename(media.caption || media.id || 'insta');
  const out = [];

  if (media.media_type === 'VIDEO' && media.media_url) {
    out.push({ url: media.media_url, filenameBase: base });
  } else if (media.media_type === 'CAROUSEL_ALBUM' && media.children?.data?.length) {
    for (const c of media.children.data) {
      if (c.media_type === 'VIDEO' && c.media_url) {
        out.push({ url: c.media_url, filenameBase: `${base}_${c.id}` });
      }
    }
  } else {
    // Not a video; skip
  }

  return out;
}

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

async function pollMessagesOnce() {
  try {
    const convs = await listIgConversations();
    if (!convs?.data?.length) return;

    for (const conv of convs.data) {
      const msgs = await getConversationMessages(conv.id);
      const list = msgs?.messages?.data || [];

      for (const m of list) {
        if (processedMessageIds.has(m.id)) continue;

        const details = await getMessage(m.id);
        processedMessageIds.add(m.id);

        const created = new Date(details.created_time).getTime();
        if (created <= lastCheck) {
          console.log("⏪ Skipping old message");
          continue;
        }

        const sender = (details.from?.username || details.from?.name || "").toLowerCase();
        console.log(`🆕 New message from ${sender} at ${details.created_time}`);

        if (sender !== DM_SENDER_USERNAME_TO_ALLOW) {
          console.log(`⛔ Ignoring message from ${sender}`);
          continue;
        }

        // 1️⃣ Prefer attached media link from Graph API shares
        if (details.shares?.data?.length) {
          for (const share of details.shares.data) {
            const mediaUrl = share.link;
            console.log(`📎 Found shared media: ${mediaUrl}`);

            const filename = `ig_share_${Date.now()}.mp4`;
            const dest = path.join(WATCH_FOLDER, filename);

            try {
              await downloadToFile(mediaUrl, dest);
              console.log(`📥 Saved shared media: ${dest}`);
            } catch (e) {
              console.error(`❌ Failed to download shared media: ${e.message}`);
            }
          }
        }

        // 2️⃣ If you still want to handle text-based IG post links (optional)
        const text = details.message || "";
        const igUrls = extractInstagramUrls(text);
        for (const igUrl of igUrls) {
          console.log(`🔗 DM from ${sender}: ${igUrl}`);
          let files = [];
          try {
            files = await resolveInstagramMediaUrls(igUrl);
          } catch (e) {
            console.warn(`⚠️ Could not resolve media: ${e.message}`);
            continue;
          }

          if (!files.length) {
            console.log("ℹ️ No downloadable video media found in that post.");
            continue;
          }

          for (const f of files) {
            const filename = `${f.filenameBase}_${Date.now()}.mp4`;
            const dest = path.join(WATCH_FOLDER, filename);
            try {
              await downloadToFile(f.url, dest);
              console.log(`📥 Saved: ${dest}`);
            } catch (e) {
              console.error(`❌ Download failed: ${e.message}`);
            }
          }
        }
      }
    }

    lastCheck = Date.now();
  } catch (err) {
    console.error(`❌ Poll error: ${err.message}`);
  }
}

function startDmPoller() {
  console.log('📩 Starting IG DM poller…');
  setInterval(pollMessagesOnce, DM_POLL_INTERVAL_MS);
}

/* ===================== MAIN ===================== */

(async function main() {
  if (!ACCESS_TOKEN || !PAGE_ID || !IG_USER_ID || !INSTAGRAM_ACCESS_TOKEN) {
    console.error('❌ Missing env: PAGE_ID, IG_USER_ID, PAGE_ACCESS_TOKEN, INSTAGRAM_ACCESS_TOKEN are required.');
    process.exit(1);
  }

  await startServer();
  startFileWatcher();
  startDmPoller();
})();
