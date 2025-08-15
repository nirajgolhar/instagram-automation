import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import chokidar from 'chokidar';
import fetch from 'node-fetch';
import ngrok from 'ngrok';
import { setTimeout as wait } from 'timers/promises';

const WATCH_FOLDER = process.env.WATCH_FOLDER;
const PORT = process.env.PORT;
const IG_USER_ID = process.env.IG_USER_ID;
const ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

let publicBaseUrl = null;

async function startServer() {
    const app = express();
    app.use('/videos', express.static(WATCH_FOLDER));
    app.listen(PORT, () => console.log(`Local server on http://localhost:${PORT}`));
    publicBaseUrl = await ngrok.connect({
        addr: PORT,
        authtoken: process.env.NGROK_AUTH_TOKEN
    });
    console.log(`Public video URL: ${publicBaseUrl}/videos/`);
}

async function uploadReel(videoFile) {
    try {
        const videoUrl = `${publicBaseUrl}/videos/${encodeURIComponent(videoFile)}`;
        const caption = generateCaption(videoFile);

        console.log(`Uploading ${videoFile} with caption: ${caption}`);

        // Step 1: Create media container
        const createRes = await fetch(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_url: videoUrl,
                caption: caption,
                media_type: 'REELS',
                access_token: ACCESS_TOKEN
            })
        });
        const createData = await createRes.json();
        if (!createData.id) throw new Error(`Create failed: ${JSON.stringify(createData)}`);

        console.log(`Media container created: ${createData.id}`);

        // Step 2: Wait until video is processed
        let status = 'IN_PROGRESS';
        while (status !== 'FINISHED') {
            const statusRes = await fetch(`https://graph.facebook.com/v20.0/${createData.id}?fields=status_code&access_token=${ACCESS_TOKEN}`);
            const statusData = await statusRes.json();
            status = statusData.status_code;
            console.log(`Processing status: ${status}`);
            if (status === 'ERROR') throw new Error(`Video processing failed`);
            if (status !== 'FINISHED') await new Promise(r => setTimeout(r, 5000)); // wait 5s
        }

        // Step 3: Publish container
        const publishRes = await fetch(`https://graph.facebook.com/v20.0/${IG_USER_ID}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creation_id: createData.id,
                access_token: ACCESS_TOKEN
            })
        });
        const publishData = await publishRes.json();
        if (!publishData.id) throw new Error(`Publish failed: ${JSON.stringify(publishData)}`);

        console.log(`Reel published: ${publishData.id}`);

        // Step 4: Delete local file
        fs.unlinkSync(path.join(WATCH_FOLDER, videoFile));
        console.log(`Deleted local file: ${videoFile}`);

    } catch (err) {
        console.error(`❌ Error uploading reel: ${err.message}`);
    }
}

function generateCaption(fileName) {
    const baseName = path.basename(fileName, path.extname(fileName));
    return `🔥 ${baseName.replace(/_/g, ' ')} 🔥\n#reels #viral #fyp`;
}

function startWatcher() {
    const watcher = chokidar.watch(WATCH_FOLDER, { persistent: true });
    let isProcessing = false;
    watcher.on('add', async filePath => {
        if (isProcessing) return;
        isProcessing = true;
        await uploadReel(path.basename(filePath));
        console.log(`⏳ Waiting 1 hour before next upload...`);
        await wait(60 * 60 * 1000);
        isProcessing = false;
    });
}

(async function main() {
    await startServer();
    startWatcher();
})();
