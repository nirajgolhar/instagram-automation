import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),
  verifyToken: process.env.VERIFY_TOKEN,
  ngrokToken: process.env.NGROK_AUTH_TOKEN,
  igUserId: process.env.IG_USER_ID,
  pageAccessToken: process.env.PAGE_ACCESS_TOKEN,
  igAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
  publicUrl: process.env.PUBLIC_URL,
  appSecret: (process.env.APP_SECRET || process.env.INSTAGRAM_APP_SECRET || "").trim(),
};