import OpenAI from "openai";
import type { KnowledgeSummary, TranscriptSegment } from "./jobs.js";

export interface SummaryResult {
  shortSummary: string;
  sections: string[];
  keywords: string[];
  learnerNotes: string[];
  model: string;
}

export interface SummarizeInput {
  title: string;
  duration: number;
  transcript: string;
  signal?: AbortSignal;
  apiConfig?: ClientApiConfig;
}

export interface KnowledgeSummarizeInput {
  title: string;
  transcript: string;
  userNotes?: string;
  signal?: AbortSignal;
  apiConfig?: ClientApiConfig;
}

export interface ClientApiConfig {
  provider?: "openai" | "deepseek" | "compatible";
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export async function correctTranscriptSegments(input: {
  title: string;
  segments: TranscriptSegment[];
  signal?: AbortSignal;
  apiConfig?: ClientApiConfig;
}): Promise<TranscriptSegment[]> {
  const provider = resolveProviderConfig(input.apiConfig);
  if (!provider.apiKey || input.segments.length === 0) {
    return input.segments;
  }

  const modelTimeoutMs = Number(process.env.TRANSCRIPT_CORRECTION_TIMEOUT_MS || 60000);
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    timeout: modelTimeoutMs
  });
  const model = await resolveModel(client, provider);
  const payload = input.segments.map((segment, index) => ({
    index,
    timestamp: segment.timestamp,
    text: segment.text
  }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "你是一个中文视频转录校对助手。只修正语音转写中的错别字、同音字、明显断句和专有名词错误；不要总结、不要扩写、不要改变原意。严格输出 JSON。"
    },
    {
      role: "user",
      content: [
        `视频文件名：${input.title}`,
        "下面是带时间戳的 transcript 片段。请结合上下文校正 text 字段。",
        "必须保持 segments 数组长度和 index 不变，只返回 {\"segments\":[{\"index\":number,\"text\":string}]}。",
        JSON.stringify({ segments: payload })
      ].join("\n")
    }
  ];

  try {
    const response = await withTimeout(
      createChatCompletion(client, {
        model,
        messages,
        maxTokens: Number(process.env.TRANSCRIPT_CORRECTION_MAX_TOKENS || 3000),
        signal: input.signal
      }),
      modelTimeoutMs,
      `转录校对请求超过 ${Math.round(modelTimeoutMs / 1000)} 秒未返回。`,
      input.signal
    );
    const text = response.choices[0]?.message?.content;
    if (!text) {
      return input.segments;
    }

    const parsed = parseModelJson(text);
    const corrected = Array.isArray(parsed.segments) ? parsed.segments : [];
    if (corrected.length === 0) {
      return input.segments;
    }

    return input.segments.map((segment, index) => {
      const item = corrected.find((candidate) => {
        const record =
          typeof candidate === "object" && candidate ? (candidate as Record<string, unknown>) : {};
        return Number(record.index) === index;
      });
      const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
      const textValue = typeof record.text === "string" ? record.text.trim() : "";
      return textValue ? { ...segment, text: textValue } : segment;
    });
  } catch {
    return input.segments;
  }
}

export async function summarizeTranscript(input: SummarizeInput): Promise<SummaryResult> {
  const provider = resolveProviderConfig(input.apiConfig);
  const apiKey = provider.apiKey;
  if (!apiKey) {
    return buildLocalFallbackSummary(input);
  }

  const modelTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    timeout: modelTimeoutMs
  });
  const model = await resolveModel(client, provider);
  const transcript = prepareTranscriptForModel(input.transcript);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "你是一个面向学习者的视频笔记助手。请只输出 JSON，不要使用 Markdown。"
    },
    {
      role: "user",
      content: [
        `视频标题：${input.title}`,
        `视频时长：${input.duration} 秒`,
        "字幕 transcript：",
        transcript,
        "",
        "请生成 JSON，字段为 shortSummary（约100字中文摘要）、sections（分段要点数组）、keywords（关键词数组）、learnerNotes（适合学习者的笔记数组）。"
      ].join("\n")
    }
  ];

  let response: Awaited<ReturnType<typeof createChatCompletion>>;
  try {
    response = await withTimeout(
      createChatCompletion(client, {
        model,
        messages,
        signal: input.signal
      }),
      modelTimeoutMs,
      `大模型请求超过 ${Math.round(modelTimeoutMs / 1000)} 秒未返回，请稍后重试或调小 MAX_TRANSCRIPT_CHARS。`,
      input.signal
    );
  } catch (error) {
    if (isRecoverableModelError(error)) {
      return buildLocalFallbackSummary(input, error instanceof Error ? error.message : "模型暂不可用");
    }
    throw error;
  }

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("大模型未返回总结内容");
  }

  const parsed = parseModelJson(text);
  return {
    shortSummary: coerceText(parsed.shortSummary),
    sections: coerceTextArray(parsed.sections),
    keywords: coerceTextArray(parsed.keywords),
    learnerNotes: coerceTextArray(parsed.learnerNotes),
    model
  };
}

export async function summarizeKnowledgeTranscript(
  input: KnowledgeSummarizeInput
): Promise<KnowledgeSummary> {
  const apiKey = resolveProviderConfig(input.apiConfig).apiKey;
  if (!apiKey) {
    return buildLocalKnowledgeFallback(input, "未配置大模型 API key");
  }

  const provider = resolveProviderConfig(input.apiConfig);
  const modelTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    timeout: modelTimeoutMs
  });
  const model = await resolveModel(client, provider);
  const transcript = prepareTranscriptForModel(input.transcript);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "你是一个知识视频学习助手。请严格根据 transcript 生成结构化学习笔记，不要编造 transcript 中不存在的内容。只输出 JSON，不要 Markdown。"
    },
    {
      role: "user",
      content: [
        `视频文件名：${input.title}`,
        input.userNotes ? `用户补充说明：${input.userNotes}` : "",
        "transcript：",
        transcript,
        "",
        "请输出 JSON，字段为：overview(string), coreConclusions(string[]), knowledgeTree({topic:string,points:string[]}[]), logicFlow({title:string,explanation:string}[]), timelineNotes({timestamp:string,note:string}[]), terms({term:string,definition:string}[]), reviewQuestions(string[])。",
        "要求：面向学习者，按知识逻辑展开；如果 transcript 只是闲聊或信息不足，请明确说明；时间轴笔记要引用 transcript 中的时间戳。"
      ]
        .filter(Boolean)
        .join("\n")
    }
  ];

  try {
    const response = await withTimeout(
      createChatCompletion(client, { model, messages, signal: input.signal }),
      modelTimeoutMs,
      `大模型请求超过 ${Math.round(modelTimeoutMs / 1000)} 秒未返回。`,
      input.signal
    );
    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("大模型未返回总结内容");
    }

    const parsed = parseModelJson(text);
    return normalizeKnowledgeSummary(parsed, model);
  } catch (error) {
    if (isRecoverableModelError(error)) {
      return buildLocalKnowledgeFallback(input, error instanceof Error ? error.message : "模型暂不可用");
    }
    throw error;
  }
}

interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  kind: "deepseek" | "nvidia" | "openai" | "compatible";
}

function resolveProviderConfig(clientConfig?: ClientApiConfig): ProviderConfig {
  const clientApiKey = clientConfig?.apiKey?.trim();
  if (clientApiKey) {
    const provider = clientConfig?.provider || "openai";
    if (provider === "deepseek") {
      return {
        apiKey: clientApiKey,
        baseURL: clientConfig?.baseURL?.trim() || "https://api.deepseek.com",
        defaultModel: clientConfig?.model?.trim() || "deepseek-v4-flash",
        kind: "deepseek"
      };
    }
    return {
      apiKey: clientApiKey,
      baseURL: clientConfig?.baseURL?.trim() || undefined,
      defaultModel: clientConfig?.model?.trim() || (provider === "openai" ? "gpt-4.1-mini" : undefined),
      kind: provider === "compatible" ? "compatible" : detectProviderKind(clientConfig?.baseURL)
    };
  }

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekApiKey) {
    return {
      apiKey: deepseekApiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
      defaultModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
      kind: "deepseek"
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  return {
    apiKey,
    baseURL,
    defaultModel: baseURL ? undefined : "gpt-4.1-mini",
    kind: detectProviderKind(baseURL)
  };
}

function detectProviderKind(baseURL?: string): ProviderConfig["kind"] {
  if (!baseURL) {
    return "openai";
  }
  if (/api\.deepseek\.com/i.test(baseURL)) {
    return "deepseek";
  }
  if (/integrate\.api\.nvidia\.com/i.test(baseURL)) {
    return "nvidia";
  }
  return "compatible";
}

async function resolveModel(client: OpenAI, provider: ProviderConfig): Promise<string> {
  const configuredModel =
    provider.kind === "deepseek"
      ? process.env.DEEPSEEK_MODEL?.trim()
      : process.env.OPENAI_MODEL?.trim();
  const baseUrl = provider.baseURL;
  if (configuredModel) {
    if (!baseUrl) {
      return configuredModel;
    }

    const availableModels = await listAvailableModels(client);
    if (availableModels.length === 0 || availableModels.includes(configuredModel)) {
      return configuredModel;
    }

    const fallbackModel = pickPreferredModel(availableModels);
    if (fallbackModel) {
      return fallbackModel;
    }

    return configuredModel;
  }

  if (provider.defaultModel) {
    return provider.defaultModel;
  }

  const availableModels = await listAvailableModels(client);
  const preferred = pickPreferredModel(availableModels);
  if (preferred) {
    return preferred;
  }

  throw new Error(
    "未配置模型名，且无法从当前 Base URL 自动获取模型列表。请在 .env 中填写 OPENAI_MODEL 或 DEEPSEEK_MODEL。"
  );
}

async function listAvailableModels(client: OpenAI): Promise<string[]> {
  try {
    const models = await client.models.list();
    return models.data.map((model) => model.id).filter(Boolean);
  } catch {
    // Some OpenAI-compatible providers do not expose /models.
    return [];
  }
}

function pickPreferredModel(ids: string[]): string | undefined {
  return (
    ids.find((id) => /deepseek-v4-flash/i.test(id)) ??
    ids.find((id) => /deepseek-v4-pro/i.test(id)) ??
    ids.find((id) => /deepseek-ai\/deepseek-v4-flash/i.test(id)) ??
    ids.find((id) => /deepseek-ai\/deepseek-v4-pro/i.test(id)) ??
    ids.find((id) => /deepseek/i.test(id) && !/coder|embed/i.test(id)) ??
    ids.find((id) => /qwen/i.test(id) && /instruct/i.test(id)) ??
    ids.find((id) => /llama/i.test(id) && /instruct/i.test(id)) ??
    ids.find((id) => /gpt-oss/i.test(id)) ??
    ids[0]
  );
}

async function createChatCompletion(
  client: OpenAI,
  params: {
    model: string;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    maxTokens?: number;
    signal?: AbortSignal;
  }
) {
  const baseParams = {
    model: params.model,
    messages: params.messages,
    temperature: 0.2,
    max_tokens: params.maxTokens ?? Number(process.env.OPENAI_MAX_TOKENS || 1000)
  };

  try {
    if (shouldSkipJsonMode()) {
      return await client.chat.completions.create(baseParams, { signal: params.signal });
    }

    return await client.chat.completions.create(
      {
        ...baseParams,
        response_format: { type: "json_object" }
      },
      { signal: params.signal }
    );
  } catch (error) {
    if (!isUnsupportedJsonModeError(error)) {
      throw error;
    }

    return client.chat.completions.create(baseParams, { signal: params.signal });
  }
}

function shouldSkipJsonMode(): boolean {
  const baseURL = process.env.DEEPSEEK_API_KEY
    ? process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
    : process.env.OPENAI_BASE_URL;
  return /integrate\.api\.nvidia\.com/i.test(baseURL ?? "");
}

function buildLocalFallbackSummary(input: SummarizeInput, reason?: string): SummaryResult {
  const lines = input.transcript.split("\n").filter(Boolean);
  const preview = lines
    .slice(0, 8)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, ""))
    .join(" ");

  return {
    shortSummary:
      preview.slice(0, 100) ||
      "已成功获取字幕。当前未配置 OPENAI_API_KEY，因此返回本地占位总结。",
    sections: lines.slice(0, 6),
    keywords: ["Bilibili", "视频字幕", "AI 总结"],
    learnerNotes: [
      reason
        ? `已成功获取字幕，但模型调用暂时不可用：${reason}`
        : "字幕获取链路已跑通，可以在 .env 中配置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY 启用真实总结。",
      "后续可加入音频转写、历史记录和收藏功能。"
    ],
    model: reason ? "local-fallback-after-model-error" : "local-fallback"
  };
}

function buildLocalKnowledgeFallback(input: KnowledgeSummarizeInput, reason: string): KnowledgeSummary {
  const lines = input.transcript.split("\n").filter(Boolean);
  const preview = lines.slice(0, 8).map((line) => line.replace(/^\[[^\]]+\]\s*/, ""));
  return {
    overview: `已获得 transcript，但暂未生成完整知识总结：${reason}`,
    coreConclusions: preview.slice(0, 3),
    knowledgeTree: [
      {
        topic: "Transcript 预览",
        points: preview.slice(0, 6)
      }
    ],
    logicFlow: preview.slice(0, 5).map((line, index) => ({
      title: `片段 ${index + 1}`,
      explanation: line
    })),
    timelineNotes: lines.slice(0, 8).map((line) => {
      const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      return {
        timestamp: match?.[1] ?? "00:00",
        note: match?.[2] ?? line
      };
    }),
    terms: [],
    reviewQuestions: ["这段视频主要讲了什么？", "哪些内容需要结合原视频进一步确认？"],
    model: "local-fallback"
  };
}

function normalizeKnowledgeSummary(parsed: Record<string, unknown>, model: string): KnowledgeSummary {
  return {
    overview: coerceText(parsed.overview),
    coreConclusions: coerceTextArray(parsed.coreConclusions),
    knowledgeTree: normalizeKnowledgeTree(parsed.knowledgeTree),
    logicFlow: normalizeLogicFlow(parsed.logicFlow),
    timelineNotes: normalizeTimelineNotes(parsed.timelineNotes),
    terms: normalizeTerms(parsed.terms),
    reviewQuestions: coerceTextArray(parsed.reviewQuestions),
    model
  };
}

function normalizeKnowledgeTree(value: unknown): KnowledgeSummary["knowledgeTree"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      topic: coerceText(record.topic ?? record.title),
      points: coerceTextArray(record.points ?? record.children ?? record.items)
    };
  });
}

function normalizeLogicFlow(value: unknown): KnowledgeSummary["logicFlow"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      title: coerceText(record.title),
      explanation: coerceText(record.explanation ?? record.summary ?? record.content)
    };
  });
}

function normalizeTimelineNotes(value: unknown): KnowledgeSummary["timelineNotes"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      timestamp: coerceText(record.timestamp ?? record.time),
      note: coerceText(record.note ?? record.summary ?? record.content)
    };
  });
}

function normalizeTerms(value: unknown): KnowledgeSummary["terms"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      term: coerceText(record.term ?? record.name),
      definition: coerceText(record.definition ?? record.explanation)
    };
  });
}

function prepareTranscriptForModel(transcript: string): string {
  const maxChars = Number(process.env.MAX_TRANSCRIPT_CHARS || 4000);
  if (transcript.length <= maxChars) {
    return transcript;
  }

  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  return [
    transcript.slice(0, headChars),
    "",
    `[字幕过长，中间已省略 ${transcript.length - maxChars} 个字符。请基于开头和结尾总结整体内容。]`,
    "",
    transcript.slice(-tailChars)
  ].join("\n");
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  signal?: AbortSignal
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (!signal) {
      return;
    }
    abortHandler = () => reject(new Error("任务已取消"));
    if (signal.aborted) {
      abortHandler();
      return;
    }
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([promise, timeoutPromise, abortPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  });
}

function extractJson(text: string): string {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return stripped.slice(start, end + 1);
  }

  return stripped;
}

function parseModelJson(text: string): Record<string, unknown> {
  const json = extractJson(text);
  const candidates = [
    json,
    json.replace(/,\s*([}\]])/g, "$1"),
    closeUnbalancedJson(json.replace(/,\s*([}\]])/g, "$1"))
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next repair candidate.
    }
  }

  throw new Error("大模型返回的 JSON 格式不完整，已改用本地降级总结。");
}

function closeUnbalancedJson(json: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of json) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if ((char === "}" || char === "]") && stack.at(-1) === char) {
      stack.pop();
    }
  }

  return json + stack.reverse().join("");
}

function coerceText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : "";
    const summary = typeof record.summary === "string" ? record.summary : "";
    const content = typeof record.content === "string" ? record.content : "";
    const text = [title, summary || content].filter(Boolean).join("：");
    return text || JSON.stringify(value);
  }

  return String(value);
}

function coerceTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return value == null ? [] : [coerceText(value)];
  }

  return value.map(coerceText).filter((item) => item.length > 0);
}

function isUnsupportedJsonModeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /response_format|json_object|unsupported|not supported|400/.test(error.message);
}

function isRecoverableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /429|rate limit|timeout|timed out|超过 \d+ 秒|503|502|504|JSON 格式/i.test(
    error.message
  );
}
