import { getQnaigcVideoConfig } from "../config/env.js";

type CreateVideoRequest = {
  model: string;
  prompt: string;
  mode: "std" | "pro";
  seconds: "5" | "10";
  sound: "on" | "off";
  input_reference: string;
  size: string;
};

type CreateVideoResponse = {
  id: string;
  status: string;
  model?: string;
};

type VideoTaskStatus =
  | "initializing"
  | "queued"
  | "in_progress"
  | "downloading"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type VideoStatusResponse = {
  id: string;
  status: VideoTaskStatus;
  progress?: number;
  task_result?: {
    videos?: Array<{
      id?: string;
      url?: string;
      duration?: string;
      size?: string;
      format?: string;
    }>;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

export type GenerateVideoInput = {
  prompt: string;
  imageUrl: string;
  seconds?: "5" | "10";
  mode?: "std" | "pro";
  sound?: "on" | "off";
  size?: string;
  timeoutMs?: number;
};

export type GenerateVideoOutput = {
  taskId: string;
  videoUrl: string;
  raw: VideoStatusResponse;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function createVideoTask(body: CreateVideoRequest): Promise<CreateVideoResponse> {
  const cfg = getQnaigcVideoConfig();
  const url = `${cfg.baseUrl}/videos`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QNAIGC videos.create failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  const json = (await res.json()) as CreateVideoResponse;
  if (!json.id) throw new Error("QNAIGC videos.create missing task id");
  return json;
}

async function getVideoTaskStatus(taskId: string): Promise<VideoStatusResponse> {
  const cfg = getQnaigcVideoConfig();
  const candidates = [`${cfg.baseUrl}/videos/${encodeURIComponent(taskId)}`, `${cfg.baseUrl}/videos/tasks/${encodeURIComponent(taskId)}`];

  let lastError = "";
  for (const url of candidates) {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.apiKey}` }
    });
    if (res.ok) return (await res.json()) as VideoStatusResponse;
    lastError = `${res.status} ${res.statusText}`;
    if (res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`QNAIGC videos.status failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
    }
  }

  throw new Error(`QNAIGC videos.status endpoint not found for task ${taskId}: ${lastError}`);
}

export async function generateVideo(input: GenerateVideoInput): Promise<GenerateVideoOutput> {
  const cfg = getQnaigcVideoConfig();
  const requestedMode = input.mode ?? "std";
  const requestedSound = input.sound ?? "on";

  const runOnce = async (mode: "std" | "pro", sound: "on" | "off"): Promise<GenerateVideoOutput> => {
    const timeoutMs = input.timeoutMs ?? 6 * 60_000;
    const started = Date.now();
    const created = await createVideoTask({
      model: cfg.videoModel,
      prompt: input.prompt.trim().slice(0, 2400),
      input_reference: input.imageUrl,
      seconds: input.seconds ?? "5",
      sound,
      mode,
      size: input.size ?? "1280x720"
    });

    let delayMs = 1500;
    while (Date.now() - started < timeoutMs) {
      const status = await getVideoTaskStatus(created.id);

      if (status.status === "completed") {
        const videoUrl = status.task_result?.videos?.[0]?.url;
        if (!videoUrl) throw new Error("QNAIGC video task completed but missing video url");
        return { taskId: created.id, videoUrl, raw: status };
      }

      if (status.status === "failed" || status.status === "cancelled" || status.status === "expired") {
        const msg = status.error?.message || "unknown error";
        throw new Error(`QNAIGC video task ${status.status}: ${msg}`);
      }

      await sleep(delayMs);
      delayMs = Math.min(delayMs + 800, 5000);
    }

    throw new Error(`QNAIGC video task timed out after ${timeoutMs}ms`);
  };

  try {
    return await runOnce(requestedMode, requestedSound);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (requestedMode === "std" && requestedSound === "on" && msg.includes("not supported") && msg.includes("sound")) {
      return await runOnce("pro", requestedSound);
    }
    throw e;
  }
}
