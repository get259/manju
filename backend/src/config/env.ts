import dotenv from "dotenv";

export type QnaigcConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type QnaigcImageConfig = {
  baseUrl: string;
  apiKey: string;
  imageModel: string;
};

export type QnaigcVideoConfig = {
  baseUrl: string;
  apiKey: string;
  videoModel: string;
};

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  dotenv.config();
  loaded = true;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function getQnaigcConfig(): QnaigcConfig {
  const baseUrl = (process.env.QNAIGC_BASE_URL || "https://api.qnaigc.com/v1").replace(/\/+$/, "");
  const model = process.env.QNAIGC_MODEL || "deepseek/deepseek-v3.2-251201";
  const apiKey = requireEnv("QNAIGC_API_KEY");
  return { baseUrl, apiKey, model };
}

export function getQnaigcImageConfig(): QnaigcImageConfig {
  const baseUrl = (process.env.QNAIGC_BASE_URL || "https://api.qnaigc.com/v1").replace(/\/+$/, "");
  const imageModel = process.env.QNAIGC_IMAGE_MODEL || "kling-v2";
  const apiKey = requireEnv("QNAIGC_API_KEY");
  return { baseUrl, apiKey, imageModel };
}

export function getQnaigcVideoConfig(): QnaigcVideoConfig {
  const baseUrl = (process.env.QNAIGC_BASE_URL || "https://api.qnaigc.com/v1").replace(/\/+$/, "");
  const videoModel = process.env.QNAIGC_VIDEO_MODEL || "kling-v2-6";
  const apiKey = requireEnv("QNAIGC_API_KEY");
  return { baseUrl, apiKey, videoModel };
}
