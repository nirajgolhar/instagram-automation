import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { config } from "../config/env.js";

import { uploadReel } from "./upload.service.js";
import { PUBLIC_URL } from "../server.js";

function normalizeInstagramUrl(instagramUrl) {
  try {
    const parsed = new URL(instagramUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (!host.includes("instagram.com")) {
      return instagramUrl;
    }

    const cleanPath = parsed.pathname.endsWith("/")
      ? parsed.pathname
      : `${parsed.pathname}/`;

    return `https://www.instagram.com${cleanPath}`;
  } catch {
    return instagramUrl.split("?")[0];
  }
}

function decodeInstagramEscapedUrl(value) {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u002F/g, "/")
    .replace(/\\x26/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

function extractVideoUrlFromHtml(html) {
  const patterns = [
    /<meta\s+property="og:video"\s+content="([^"]+)"/i,
    /<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/i,
    /"video_url":"(https:[^"]+)"/i,
    /"contentUrl":"(https:[^"]+)"/i,
    /"video_versions":\[\{[^\]]*?"url":"(https:[^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeInstagramEscapedUrl(match[1]);
    }
  }

  return null;
}

async function fetchInstagramPage(instagramUrl) {
  const pageRes = await fetch(instagramUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!pageRes.ok) {
    throw new Error(`Instagram page fetch failed: HTTP ${pageRes.status}`);
  }

  return {
    html: await pageRes.text(),
    finalUrl: pageRes.url,
  };
}

async function resolveFromInstagramJson(instagramUrl) {
  const jsonUrl = `${instagramUrl}${instagramUrl.includes("?") ? "&" : "?"}__a=1&__d=dis`;
  const jsonRes = await fetch(jsonUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "x-ig-app-id": "936619743392459",
      Accept: "application/json,text/plain,*/*",
    },
    redirect: "follow",
  });

  if (!jsonRes.ok) {
    return null;
  }

  try {
    const data = await jsonRes.json();

    const candidates = [
      data?.graphql?.shortcode_media?.video_url,
      data?.items?.[0]?.video_versions?.[0]?.url,
      data?.data?.xdt_shortcode_media?.video_url,
    ];

    return candidates.find(Boolean) || null;
  } catch {
    return null;
  }
}

async function resolveFromInstagramPage(instagramUrl) {
  const { html, finalUrl } = await fetchInstagramPage(instagramUrl);

  const htmlVideoUrl = extractVideoUrlFromHtml(html);
  if (htmlVideoUrl) {
    return htmlVideoUrl;
  }

  const finalNormalized = normalizeInstagramUrl(finalUrl);
  if (finalNormalized !== instagramUrl) {
    const jsonVideoFromFinal = await resolveFromInstagramJson(finalNormalized);
    if (jsonVideoFromFinal) {
      return jsonVideoFromFinal;
    }
  }

  return null;
}

async function resolveFromDdInstagram(instagramUrl) {
  const ddUrl = instagramUrl.replace(
    /https:\/\/((www\.)?)instagram\.com/i,
    "https://www.ddinstagram.com",
  );
  try {
    const { html } = await fetchInstagramPage(ddUrl);
    return extractVideoUrlFromHtml(html);
  } catch (err) {
    if (String(err.message || "").includes("ENOTFOUND")) {
      return null;
    }

    throw err;
  }
}

async function resolvePublicReelVideoUrl(instagramUrl) {
  const normalizedUrl = normalizeInstagramUrl(instagramUrl);

  if (config.pageAccessToken) {
    const oembedUrl = `https://graph.facebook.com/v20.0/instagram_oembed?url=${encodeURIComponent(normalizedUrl)}&access_token=${config.pageAccessToken}`;

    const oembed = await fetch(oembedUrl).then((r) => r.json());
    console.log("🔍 oEmbed response:", JSON.stringify(oembed, null, 2));

    if (oembed.media_id) {
      const media = await fetch(
        `https://graph.facebook.com/v20.0/${oembed.media_id}?fields=media_type,media_url&access_token=${config.pageAccessToken}`,
      ).then((r) => r.json());

      if (media.media_type === "VIDEO" && media.media_url) {
        return media.media_url;
      }
    } else {
      console.log("⚠️ oEmbed media_id unavailable, using public-page fallback");
    }
  }

  const jsonVideoUrl = await resolveFromInstagramJson(normalizedUrl);
  if (jsonVideoUrl) {
    return jsonVideoUrl;
  }

  const htmlVideoUrl = await resolveFromInstagramPage(normalizedUrl);
  if (htmlVideoUrl) {
    return htmlVideoUrl;
  }

  const ddVideoUrl = await resolveFromDdInstagram(normalizedUrl);
  if (ddVideoUrl) {
    return ddVideoUrl;
  }

  throw new Error("No video URL found via Graph, JSON, or page parsers");
}

async function downloadFromResolvedUrl(videoUrl, dest) {
  const res = await fetch(videoUrl);

  if (!res.ok) {
    throw new Error(`Failed to fetch video URL: HTTP ${res.status}`);
  }

  const fileStream = fs.createWriteStream(dest);

  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

async function downloadWithYtDlp(instagramUrl, dest) {
  let ytdlp;

  try {
    ({ default: ytdlp } = await import("yt-dlp-exec"));
  } catch {
    const binPath = await ensureLocalYtDlpBinary();
    await runYtDlpBinary(binPath, instagramUrl, dest);
    return;
  }

  await ytdlp(instagramUrl, {
    output: path.resolve(dest),
    format: "best[ext=mp4]/best",
    noWarnings: true,
    noCheckCertificates: true,
    geoBypass: true,
  });
}

function runYtDlpBinary(binPath, instagramUrl, dest) {
  return new Promise((resolve, reject) => {
    const args = [
      instagramUrl,
      "-o",
      path.resolve(dest),
      "-f",
      "best[ext=mp4]/best",
      "--no-warnings",
      "--no-check-certificates",
      "--geo-bypass",
    ];

    const child = spawn(binPath, args);

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`yt-dlp binary failed with exit code ${code}: ${stderr.trim()}`),
      );
    });
  });
}

async function ensureLocalYtDlpBinary() {
  const binDir = path.resolve(".bin");
  const binPath = path.join(binDir, "yt-dlp");

  try {
    await access(binPath, fs.constants.X_OK);
    return binPath;
  } catch {
    // Continue to download when binary does not exist or is not executable.
  }

  await mkdir(binDir, { recursive: true });

  const binaryName = process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;
  const res = await fetch(downloadUrl, { redirect: "follow" });

  if (!res.ok) {
    throw new Error(`Failed to download yt-dlp binary: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await writeFile(binPath, buffer);
  await chmod(binPath, 0o755);

  return binPath;
}

export async function downloadInstagramVideo(instagramUrl, caption = "") {
  try {
    console.log("🔗 Resolving:", instagramUrl);

    let videoUrl = null;
    const filename = `ig_${Date.now()}.mp4`;
    const dest = path.join("downloads", filename);

    // 1️⃣ If it's a DM attachment (lookaside link)
    if (instagramUrl.includes("lookaside.fbsbx.com")) {
      console.log("📎 Detected DM attachment");
      videoUrl = instagramUrl;
    }

    // 2️⃣ If it's a public Instagram reel link
    else if (instagramUrl.includes("instagram.com")) {
      console.log("🌍 Detected public reel URL");
      try {
        videoUrl = await resolvePublicReelVideoUrl(instagramUrl);
      } catch (resolveErr) {
        console.log("⚠️ Resolver failed, falling back to yt-dlp:", resolveErr.message);
      }
    }

    // 3️⃣ Download file from resolved URL first; if that fails on Instagram URLs, use yt-dlp.
    if (videoUrl) {
      try {
        await downloadFromResolvedUrl(videoUrl, dest);
      } catch (httpErr) {
        if (!instagramUrl.includes("instagram.com")) {
          throw httpErr;
        }

        console.log("⚠️ Direct video fetch failed, using yt-dlp:", httpErr.message);
        await downloadWithYtDlp(instagramUrl, dest);
      }
    } else if (instagramUrl.includes("instagram.com")) {
      console.log("⚙️ Using yt-dlp as primary fallback");
      await downloadWithYtDlp(instagramUrl, dest);
    } else {
      console.log("❌ Could not resolve video URL");
      return;
    }

    console.log("📥 Downloaded:", filename);

    // 🔥 Build public URL
    const publicVideoUrl = `${PUBLIC_URL}/videos/${filename}`;

    console.log("🌍 Public Video URL:", publicVideoUrl);

    // 🔥 Upload to Instagram
    await uploadReel(publicVideoUrl, caption, dest);
  } catch (err) {
    console.error("❌ Download error:", err.message);
  }
}
