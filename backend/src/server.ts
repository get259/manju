import Fastify from "fastify";
import cors from "@fastify/cors";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { deleteImageById, deleteVideoById, getImageById, getVideoById, getVideosByIds, listResources, storeImageFromUrl, storeVideoFromUrl } from "./db/sqlite.js";
import { parseStoryboard } from "./domain/storyboard.js";
import { generateImage } from "./llm/qnaigcImageClient.js";
import { generateScript } from "./llm/qnaigcClient.js";
import { generateVideo } from "./llm/qnaigcVideoClient.js";
import { STORYBOARD_SYSTEM_PROMPT } from "./prompts/storyboard.js";
import { storeVideoFromBuffer } from "./db/sqlite.js";

const execFileAsync = promisify(execFile);
const ffmpegPath = ffmpegInstaller.path;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asShotIndex(v: unknown): number | undefined {
  if (typeof v !== "number") return undefined;
  if (!Number.isFinite(v)) return undefined;
  const i = Math.trunc(v);
  return i > 0 ? i : undefined;
}

function asSeconds(v: unknown): "5" | "10" {
  return v === "10" ? "10" : "5";
}

function asVideoIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const id = Number.parseInt(String(item), 10);
    if (Number.isFinite(id) && id > 0) out.push(id);
  }
  return out;
}

const VIDEO_DEFAULTS = {
  sound: "on" as const,
  mode: "std" as const,
  size: "1280x720"
};

function validateVideoCompatibility(videos: Array<{ mimeType: string; resultSize: string | null; requestedSize: string | null; sound: string | null }>) {
  const mimeSet = new Set(videos.map((v) => v.mimeType).filter(Boolean));
  const sizeSet = new Set(videos.map((v) => v.resultSize || v.requestedSize || "").filter(Boolean));
  const soundSet = new Set(videos.map((v) => v.sound || "").filter(Boolean));
  const checks = {
    sameMimeType: mimeSet.size <= 1,
    sameVideoSize: sizeSet.size <= 1,
    sameSoundSetting: soundSet.size <= 1
  };
  const reasons: string[] = [];
  if (!checks.sameMimeType) reasons.push("视频编码/容器不一致");
  if (!checks.sameVideoSize) reasons.push("视频分辨率不一致");
  if (!checks.sameSoundSetting) reasons.push("声音配置不一致");
  return { checks, reasons };
}

async function mergeVideosWithFfmpeg(buffers: Buffer[]): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manju-merge-"));
  const listPath = path.join(dir, "list.txt");
  const outPath = path.join(dir, "merged.mp4");
  try {
    const lines: string[] = [];
    for (let i = 0; i < buffers.length; i += 1) {
      const filePath = path.join(dir, `part-${String(i + 1).padStart(3, "0")}.mp4`);
      const chunk = buffers[i];
      if (!chunk) throw new Error("missing input buffer while merging");
      await fs.writeFile(filePath, chunk);
      const escaped = filePath.replaceAll("'", "'\\''");
      lines.push(`file '${escaped}'`);
    }
    await fs.writeFile(listPath, lines.join("\n"), "utf8");
    await execFileAsync(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin && corsOrigin.trim().length > 0) await app.register(cors, { origin: corsOrigin });

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Params: { id?: string } }>("/api/images/:id", async (req, reply) => {
    const id = Number.parseInt(req.params?.id || "", 10);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: "invalid image id" });
    const image = getImageById(id);
    if (!image) return reply.status(404).send({ error: "image not found" });
    reply.header("Content-Type", image.mimeType);
    return reply.send(image.content);
  });

  app.get<{ Params: { id?: string } }>("/api/videos/:id", async (req, reply) => {
    const id = Number.parseInt(req.params?.id || "", 10);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: "invalid video id" });
    const video = getVideoById(id);
    if (!video) return reply.status(404).send({ error: "video not found" });
    reply.header("Content-Type", video.mimeType);
    return reply.send(video.content);
  });

  app.get<{ Querystring: { limit?: string } }>("/api/resources", async (req) => {
    const limitRaw = Number.parseInt(req.query?.limit || "200", 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;
    return { items: listResources(limit) };
  });

  app.delete<{ Params: { kind?: string; id?: string } }>("/api/resources/:kind/:id", async (req, reply) => {
    const kind = req.params?.kind || "";
    const id = Number.parseInt(req.params?.id || "", 10);
    if (!Number.isFinite(id) || id <= 0) return reply.status(400).send({ error: "invalid resource id" });

    if (kind === "image") {
      const ok = deleteImageById(id);
      if (!ok) return reply.status(404).send({ error: "image not found" });
      return { ok: true };
    }

    if (kind === "video") {
      const ok = deleteVideoById(id);
      if (!ok) return reply.status(404).send({ error: "video not found" });
      return { ok: true };
    }

    return reply.status(400).send({ error: "invalid resource kind" });
  });

  app.post<{ Body: { videoIds?: unknown } }>("/api/sequences/validate", async (req, reply) => {
    const videoIds = asVideoIds(req.body?.videoIds);
    if (videoIds.length === 0) return reply.status(400).send({ error: "videoIds is required" });

    const ordered = getVideosByIds(videoIds);
    const missing = videoIds.filter((id) => !ordered.find((v) => v.id === id));

    const base = validateVideoCompatibility(ordered);
    const checks = { ...base.checks, hasMissingVideos: missing.length > 0 };
    const reasons = [...base.reasons];
    if (checks.hasMissingVideos) reasons.push(`存在缺失视频ID: ${missing.join(",")}`);

    return {
      ok: reasons.length === 0,
      checks,
      reasons,
      videos: videoIds.map((id) => ordered.find((v) => v.id === id) || null)
    };
  });

  app.post<{ Body: { videoIds?: unknown } }>("/api/sequences/merge", async (req, reply) => {
    const videoIds = asVideoIds(req.body?.videoIds);
    if (videoIds.length < 2) return reply.status(400).send({ error: "at least 2 videos are required" });

    const orderedMeta = getVideosByIds(videoIds);
    const missing = videoIds.filter((id) => !orderedMeta.find((v) => v.id === id));
    if (missing.length > 0) return reply.status(400).send({ error: `missing videos: ${missing.join(",")}` });

    const compat = validateVideoCompatibility(orderedMeta);
    if (compat.reasons.length > 0) {
      return reply.status(400).send({ error: "videos are not compatible for concat", reasons: compat.reasons, checks: compat.checks });
    }

    try {
      const ordered = videoIds
        .map((id) => getVideoById(id))
        .filter((v): v is NonNullable<ReturnType<typeof getVideoById>> => Boolean(v));
      if (ordered.length !== videoIds.length) return reply.status(400).send({ error: "some videos are not readable" });
      const merged = await mergeVideosWithFfmpeg(ordered.map((v) => v.content));
      const first = orderedMeta[0];
      if (!first) return reply.status(400).send({ error: "no videos to merge" });
      const local = storeVideoFromBuffer(merged, first.mimeType || "video/mp4", `local-merge://${Date.now()}`, {
        taskId: `merge-${Date.now()}`,
        model: "ffmpeg-concat",
        mode: "std",
        sound: first.sound === "off" ? "off" : "on",
        requestedSeconds: first.requestedSeconds === "10" ? "10" : "5",
        requestedSize: first.requestedSize || VIDEO_DEFAULTS.size,
        resultSize: first.resultSize || first.requestedSize || VIDEO_DEFAULTS.size,
        resultFormat: first.resultFormat || "mp4"
      });

      return {
        videoId: local.id,
        videoUrl: `/api/videos/${local.id}`,
        mergedFrom: videoIds,
        message: "merged successfully"
      };
    } catch (e) {
      req.log.error(e);
      const details = e instanceof Error ? e.message : "unknown error";
      return reply.status(500).send({ error: "sequence merge failed", details });
    }
  });

  app.post<{ Body: { prompt?: unknown } }>("/api/scripts/generate", async (req, reply) => {
    const prompt = asString(req.body?.prompt).trim();
    if (!prompt) return reply.status(400).send({ error: "prompt is required" });

    try {
      const result = await generateScript({
        messages: [
          { role: "system", content: STORYBOARD_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ]
      });

      const shots = parseStoryboard(result.text, 5);
      return {
        text: result.text,
        rawText: result.text,
        shots: shots.map((s) => ({ index: s.index, text: s.text, fields: s.fields })),
        usage: result.raw.usage
      };
    } catch (e) {
      req.log.error(e);
      const details = e instanceof Error ? e.message : "unknown error";
      return reply.status(500).send({ error: "script generation failed", details });
    }
  });

  app.post<{ Body: { shotText?: unknown; shotIndex?: unknown } }>("/api/images/generate", async (req, reply) => {
    const shotText = asString(req.body?.shotText).trim();
    if (!shotText) return reply.status(400).send({ error: "shotText is required" });

    const shotIndex = asShotIndex(req.body?.shotIndex);

    try {
      const img = await generateImage({
        prompt: shotText,
        aspectRatio: "16:9",
        timeoutMs: 90_000
      });

      const local = await storeImageFromUrl(img.imageUrl, shotIndex, shotText);
      return {
        imageId: local.id,
        imageUrl: `/api/images/${local.id}`,
        sourceUrl: img.imageUrl,
        taskId: img.taskId,
        shotIndex,
        usage: { quantity: img.raw.quantity, mimeType: local.mimeType }
      };
    } catch (e) {
      req.log.error(e);
      const details = e instanceof Error ? e.message : "unknown error";
      return reply.status(500).send({ error: "image generation failed", details });
    }
  });

  app.post<{ Body: { shotText?: unknown; imageId?: unknown; shotIndex?: unknown; seconds?: unknown } }>(
    "/api/videos/generate",
    async (req, reply) => {
      const shotText = asString(req.body?.shotText).trim();
      if (!shotText) return reply.status(400).send({ error: "shotText is required" });

      const imageId = Number.parseInt(String(req.body?.imageId ?? ""), 10);
      if (!Number.isFinite(imageId) || imageId <= 0) return reply.status(400).send({ error: "imageId is required" });

      const image = getImageById(imageId);
      if (!image) return reply.status(404).send({ error: "image not found" });

      const shotIndex = asShotIndex(req.body?.shotIndex);
      const seconds = asSeconds(req.body?.seconds);

      try {
        const video = await generateVideo({
          prompt: shotText,
          imageUrl: image.sourceUrl,
          seconds,
          sound: VIDEO_DEFAULTS.sound,
          mode: VIDEO_DEFAULTS.mode,
          size: VIDEO_DEFAULTS.size,
          timeoutMs: 8 * 60_000
        });

        const first = video.raw.task_result?.videos?.[0];
        const local = await storeVideoFromUrl(video.videoUrl, {
          shotIndex,
          shotText,
          imageId,
          taskId: video.taskId,
          model: process.env.QNAIGC_VIDEO_MODEL || "kling-v2-6",
          mode: VIDEO_DEFAULTS.mode,
          sound: VIDEO_DEFAULTS.sound,
          requestedSeconds: seconds,
          requestedSize: VIDEO_DEFAULTS.size,
          resultDuration: first?.duration,
          resultSize: first?.size,
          resultFormat: first?.format
        });
        return {
          videoId: local.id,
          videoUrl: `/api/videos/${local.id}`,
          sourceUrl: video.videoUrl,
          taskId: video.taskId,
          shotIndex,
          seconds,
          usage: { mimeType: local.mimeType },
          defaults: VIDEO_DEFAULTS
        };
      } catch (e) {
        req.log.error(e);
        const details = e instanceof Error ? e.message : "unknown error";
        return reply.status(500).send({ error: "video generation failed", details });
      }
    }
  );

  return app;
}
