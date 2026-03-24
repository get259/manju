import { getQnaigcImageConfig } from "../config/env.js";

type CreateImageTaskRequest = {
  model: string;
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  negative_prompt?: string;
  image?: string;
};

type CreateImageTaskResponse = {
  task_id: string;
};

export type ImageTaskStatus = "submitted" | "processing" | "succeed" | "failed";

type ImageTaskStatusResponse = {
  task_id: string;
  created: number;
  status: ImageTaskStatus;
  status_message: string;
  data?: Array<{ index: number; url: string }>;
  quantity?: number;
};

export type GenerateImageInput = {
  prompt: string;
  aspectRatio?: string;
  negativePrompt?: string;
  n?: number;
  timeoutMs?: number;
};

export type GenerateImageOutput = {
  taskId: string;
  imageUrl: string;
  raw: ImageTaskStatusResponse;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clampPrompt(prompt: string, maxChars: number): string {
  const p = prompt.trim();
  if (p.length <= maxChars) return p;
  return p.slice(0, maxChars);
}

async function createImageTask(req: CreateImageTaskRequest): Promise<CreateImageTaskResponse> {
  const cfg = getQnaigcImageConfig();
  const url = `${cfg.baseUrl}/images/generations`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(req)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QNAIGC images.generation failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  const json = (await res.json()) as CreateImageTaskResponse;
  if (!json.task_id || json.task_id.trim().length === 0) throw new Error("QNAIGC images.generation missing task_id");
  return json;
}

async function getImageTaskStatus(taskId: string): Promise<ImageTaskStatusResponse> {
  const cfg = getQnaigcImageConfig();
  const url = `${cfg.baseUrl}/images/tasks/${encodeURIComponent(taskId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QNAIGC images.task failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  return (await res.json()) as ImageTaskStatusResponse;
}

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
  const cfg = getQnaigcImageConfig();
  const timeoutMs = input.timeoutMs ?? 90_000;
  const started = Date.now();

  const task = await createImageTask({
    model: cfg.imageModel,
    prompt: clampPrompt(input.prompt, 2400),
    n: input.n ?? 1,
    aspect_ratio: input.aspectRatio ?? "16:9",
    negative_prompt: input.negativePrompt
  });

  let delayMs = 800;
  while (Date.now() - started < timeoutMs) {
    const status = await getImageTaskStatus(task.task_id);
    if (status.status === "succeed") {
      const url = status.data?.[0]?.url;
      if (!url) throw new Error("QNAIGC image task succeeded but missing url");
      return { taskId: task.task_id, imageUrl: url, raw: status };
    }
    if (status.status === "failed") {
      throw new Error(`QNAIGC image task failed: ${status.status_message}`);
    }

    await sleep(delayMs);
    delayMs = Math.min(Math.floor(delayMs * 1.25), 2500);
  }

  throw new Error(`QNAIGC image task timed out after ${timeoutMs}ms`);
}
