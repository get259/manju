import { getQnaigcConfig } from "../config/env.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  name?: string;
};

type ChatCompletionsRequest = {
  model: string;
  messages: Array<{ role: ChatRole; content: string; name?: string }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: false;
};

type ChatCompletionsResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type GenerateScriptInput = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type GenerateScriptOutput = {
  text: string;
  raw: ChatCompletionsResponse;
};

export async function generateScript(input: GenerateScriptInput): Promise<GenerateScriptOutput> {
  const cfg = getQnaigcConfig();
  const url = `${cfg.baseUrl}/chat/completions`;

  const body: ChatCompletionsRequest = {
    model: cfg.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    stream: false
  };

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
    throw new Error(`QNAIGC chat.completions failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  const json = (await res.json()) as ChatCompletionsResponse;
  const out = json.choices?.[0]?.message?.content;
  if (!out || out.trim().length === 0) {
    throw new Error("QNAIGC response missing assistant content");
  }
  return { text: out, raw: json };
}
