import cors from "cors";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildTranscript,
  fetchBilibiliAudioUrl,
  fetchSubtitleLines,
  fetchVideoInfo,
  isTranscriptRelevantToTitle,
  transcriptToText
} from "./bilibili.js";
import {
  createJob,
  getJob,
  listJobs,
  updateJob,
  type JobRecord,
  type KnowledgeSummary,
  type TranscriptSegment
} from "./jobs.js";
import {
  correctTranscriptSegments,
  summarizeKnowledgeTranscript,
  summarizeTranscript
} from "./summarizer.js";
import {
  mergeTranscriptSegments,
  parsePlainTranscript,
  segmentsToSrt,
  segmentsToTxt,
  transcribeAudio,
  transcriptSegmentsToText
} from "./transcriber.js";
import {
  ensureStorageDirs,
  downloadAudioFromOnlineVideo,
  extractAudio,
  extractAudioFromUrl,
  isDirectVideoUrl,
  isSupportedVideo,
  processedCacheDir,
  videoUploadDir
} from "./video.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 2048);

await ensureStorageDirs();

const upload = multer({
  dest: videoUploadDir,
  limits: {
    fileSize: maxUploadMb * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/jobs", (_req, res) => {
  res.json(
    listJobs().map((job) => ({
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      result: job.result
        ? {
            video: job.result.video,
            transcriptCount: job.result.transcript.length,
            duration: estimateDuration(job.result.transcript)
          }
        : null
    }))
  );
});

app.post("/api/jobs", upload.single("video"), async (req, res) => {
  try {
    const manualTranscript = String(req.body?.manualTranscript ?? "").trim();
    if (!req.file && !manualTranscript) {
      return res.status(400).json({ error: "请上传视频文件或粘贴 transcript" });
    }

    if (req.file && !isSupportedVideo(req.file.originalname)) {
      return res.status(400).json({ error: "暂只支持 mp4、mov、mkv、webm 视频文件" });
    }

    const job = createJob("任务已加入队列");
    res.json({ jobId: job.id, status: job.status });

    void processLocalVideoJob(job.id, {
      file: req.file,
      manualTranscript,
      notes: String(req.body?.notes ?? "").trim()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建任务失败";
    res.status(500).json({ error: message });
  }
});

app.post("/api/jobs/url", async (req, res) => {
  try {
    const url = String(req.body?.url ?? "").trim();
    if (!url) {
      return res.status(400).json({ error: "请粘贴在线视频链接" });
    }

    const parsedUrl = parseHttpUrl(url);
    if (!parsedUrl) {
      return res.status(400).json({ error: "请提供 http 或 https 视频链接" });
    }

    const job = createJob("在线视频任务已加入队列");
    res.json({ jobId: job.id, status: job.status });

    void processOnlineVideoJob(job.id, {
      url: parsedUrl.toString(),
      notes: String(req.body?.notes ?? "").trim()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建任务失败";
    res.status(500).json({ error: message });
  }
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "任务不存在" });
  }
  return res.json(job);
});

app.patch("/api/jobs/:jobId/title", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.result) {
    return res.status(404).json({ error: "任务结果不存在" });
  }

  const title = String(req.body?.title ?? "").trim();
  if (!title) {
    return res.status(400).json({ error: "标题不能为空" });
  }

  const updated = updateJob(job.id, {
    result: {
      ...job.result,
      video: {
        ...job.result.video,
        originalName: title.slice(0, 180)
      }
    }
  });

  return res.json(updated);
});

app.patch("/api/jobs/:jobId/transcript", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.result) {
    return res.status(404).json({ error: "任务结果不存在" });
  }

  const segments = req.body?.segments;
  if (!Array.isArray(segments)) {
    return res.status(400).json({ error: "请提供 segments 数组" });
  }

  const transcript = job.result.transcript.map((segment, index) => {
    const patch = segments[index];
    return {
      ...segment,
      text: typeof patch?.text === "string" ? patch.text.trim() : segment.text
    };
  });

  const updated = updateJob(job.id, {
    result: {
      ...job.result,
      transcript
    }
  });

  return res.json(updated);
});

app.get("/api/jobs/:jobId/transcript.txt", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.result) {
    return res.status(404).json({ error: "任务结果不存在" });
  }
  const filename = buildDownloadFilename(job.result.video.originalName, "txt");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(filename));
  return res.send(segmentsToTxt(job.result.transcript));
});

app.get("/api/jobs/:jobId/transcript.srt", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.result) {
    return res.status(404).json({ error: "任务结果不存在" });
  }
  const filename = buildDownloadFilename(job.result.video.originalName, "srt");
  res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(filename));
  return res.send(segmentsToSrt(job.result.transcript));
});

app.get("/api/jobs/:jobId/notes.md", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.result) {
    return res.status(404).json({ error: "任务结果不存在" });
  }

  const filename = buildDownloadFilename(job.result.video.originalName, "md");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(filename));
  return res.send(buildNotesMarkdown(job));
});

app.post("/api/jobs/:jobId/save-obsidian", async (req, res) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job?.result) {
      return res.status(404).json({ error: "任务结果不存在" });
    }

    const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim();
    if (!vaultPath) {
      return res.status(400).json({ error: "请先在 .env 配置 OBSIDIAN_VAULT_PATH" });
    }

    const notesDir = String(req.body?.folder ?? process.env.OBSIDIAN_NOTES_DIR ?? "BiliNote").trim();
    const outputDir = path.join(path.resolve(vaultPath), sanitizeRelativePath(notesDir));
    const filename = buildMarkdownFilename(job);
    const outputPath = path.join(outputDir, filename);

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, buildNotesMarkdown(job), "utf8");

    return res.json({ ok: true, path: outputPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存到 Obsidian 失败";
    return res.status(500).json({ error: message });
  }
});

app.get("/api/jobs/:jobId/video", async (req, res) => {
  const job = getJob(req.params.jobId);
  const videoPath = job?.result?.video.storedPath;
  if (!videoPath) {
    return res.status(404).json({ error: "视频文件不存在" });
  }

  try {
    const info = await stat(videoPath);
    const contentType = videoContentType(videoPath);
    const range = req.headers.range;

    if (!range) {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", info.size);
      res.setHeader("Accept-Ranges", "bytes");
      return createReadStream(videoPath).pipe(res);
    }

    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : info.size - 1;
    if (!match || start >= info.size || end >= info.size || start > end) {
      res.setHeader("Content-Range", `bytes */${info.size}`);
      return res.sendStatus(416);
    }

    res.status(206);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", end - start + 1);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    res.setHeader("Accept-Ranges", "bytes");
    return createReadStream(videoPath, { start, end }).pipe(res);
  } catch {
    return res.status(404).json({ error: "视频文件不存在" });
  }
});

app.post("/api/summarize", async (req, res) => {
  try {
    const url = String(req.body?.url ?? "").trim();
    if (!url) {
      return res.status(400).json({ error: "请提供 Bilibili 视频链接" });
    }

    const video = await fetchVideoInfo(url);
    const subtitleResult = await fetchSubtitleLines(video);
    const transcript = buildTranscript(subtitleResult.lines);

    if (transcript.length === 0) {
      return res.json({
        status: "no_subtitle",
        message: "该视频暂未检测到可用字幕",
        video,
        transcript: [],
        debug: subtitleResult.debug
      });
    }

    if (!isTranscriptRelevantToTitle(video.title, transcript)) {
      return res.json({
        status: "no_subtitle",
        message:
          "检测到字幕内容与视频标题不匹配，可能是 B 站接口返回了错误字幕。已停止总结，避免生成错误内容。",
        video,
        transcript,
        debug: subtitleResult.debug
      });
    }

    const transcriptText = transcriptToText(transcript);
    const summary = await summarizeTranscript({
      title: video.title,
      duration: video.duration,
      transcript: transcriptText
    });

    return res.json({
      status: "ok",
      video,
      transcript,
      debug: subtitleResult.debug,
      summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务端处理失败";
    return res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`BiliNote AI server listening on http://localhost:${port}`);
});

async function processLocalVideoJob(
  jobId: string,
  input: {
    file?: Express.Multer.File;
    manualTranscript: string;
    notes: string;
  }
) {
  const originalName = input.file ? normalizeUploadFilename(input.file.originalname) : "手动 transcript";
  const storedPath = input.file?.path;
  let audioPath: string | undefined;
  let videoHash: string | undefined;

  try {
    let originalTranscript = parsePlainTranscript(input.manualTranscript);

    if (input.file && originalTranscript.length === 0) {
      videoHash = await hashFile(input.file.path);
      const cached = await readProcessedVideoCache(videoHash);
      if (cached) {
        updateJob(jobId, {
          status: "done",
          progress: 100,
          message: "已复用缓存结果",
          result: {
            video: {
              originalName,
              storedPath: path.resolve(input.file.path)
            },
            originalTranscript: cached.originalTranscript,
            transcript: cached.transcript,
            summary: cached.summary
          }
        });
        return;
      }

      updateJob(jobId, {
        status: "extracting_audio",
        progress: 20,
        message: "正在提取音频"
      });
      audioPath = await extractAudio(input.file.path, jobId);

      updateJob(jobId, {
        status: "transcribing",
        progress: 45,
        message: "正在使用本地 Whisper 转写"
      });
      originalTranscript = await transcribeAudio(audioPath, jobId);
    }

    if (originalTranscript.length === 0) {
      throw new Error("未获得 transcript，请检查视频音频或粘贴 transcript 后重试。");
    }

    let transcript = mergeTranscriptSegments(originalTranscript);

    updateJob(jobId, {
      status: "summarizing",
      progress: 65,
      message: "正在校正转录文本"
    });

    transcript = await correctTranscriptSegments({
      title: originalName,
      segments: transcript
    });

    updateJob(jobId, {
      status: "summarizing",
      progress: 78,
      message: "正在生成知识总结"
    });

    const transcriptText = transcriptSegmentsToText(transcript);
    const summary = await summarizeKnowledgeTranscript({
      title: originalName,
      transcript: transcriptText,
      userNotes: input.notes
    });

    const result = {
      video: {
        originalName,
        storedPath: storedPath ? path.resolve(storedPath) : undefined,
        audioPath: audioPath ? path.resolve(audioPath) : undefined
      },
      originalTranscript,
      transcript,
      summary
    };

    updateJob(jobId, {
      status: "done",
      progress: 100,
      message: "处理完成",
      result
    });

    if (videoHash) {
      await writeProcessedVideoCache(videoHash, {
        originalTranscript,
        transcript,
        summary
      });
    }
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: "处理失败",
      error: error instanceof Error ? error.message : "处理失败",
      result: {
        video: {
          originalName,
          storedPath: storedPath ? path.resolve(storedPath) : undefined,
          audioPath: audioPath ? path.resolve(audioPath) : undefined
        },
        originalTranscript: input.manualTranscript ? parsePlainTranscript(input.manualTranscript) : [],
        transcript: input.manualTranscript
          ? mergeTranscriptSegments(parsePlainTranscript(input.manualTranscript))
          : []
      }
    });
  }
}

async function processOnlineVideoJob(
  jobId: string,
  input: {
    url: string;
    notes: string;
  }
) {
  const metadata = await resolveOnlineVideoMetadata(input.url);
  let audioPath: string | undefined;

  try {
    updateJob(jobId, {
      status: "extracting_audio",
      progress: 18,
      message: "正在读取在线视频音频"
    });

    if (metadata.audioUrl) {
      audioPath = await extractAudioFromUrl(metadata.audioUrl, jobId, metadata.pageUrl ?? input.url);
    } else if (isDirectVideoUrl(input.url)) {
      audioPath = await extractAudioFromUrl(input.url, jobId);
    } else {
      audioPath = await downloadAudioFromOnlineVideo(input.url, jobId);
    }

    updateJob(jobId, {
      status: "transcribing",
      progress: 45,
      message: "正在使用本地 Whisper 转写在线视频音频"
    });

    const originalTranscript = await transcribeAudio(audioPath, jobId);
    if (originalTranscript.length === 0) {
      throw new Error("未获得 transcript，请检查该在线视频是否包含可读取音轨。");
    }

    let transcript = mergeTranscriptSegments(originalTranscript);

    updateJob(jobId, {
      status: "summarizing",
      progress: 65,
      message: "正在校正转录文本"
    });

    transcript = await correctTranscriptSegments({
      title: metadata.title,
      segments: transcript
    });

    updateJob(jobId, {
      status: "summarizing",
      progress: 78,
      message: "正在生成知识总结"
    });

    const transcriptText = transcriptSegmentsToText(transcript);
    const summary = await summarizeKnowledgeTranscript({
      title: metadata.title,
      transcript: transcriptText,
      userNotes: input.notes
    });

    updateJob(jobId, {
      status: "done",
      progress: 100,
      message: "处理完成",
      result: {
        video: {
          originalName: metadata.title,
          sourceUrl: input.url,
          playbackUrl: metadata.playbackUrl,
          embedUrl: metadata.embedUrl,
          audioPath: path.resolve(audioPath)
        },
        originalTranscript,
        transcript,
        summary
      }
    });
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: "处理失败",
      error: buildOnlineVideoError(error),
      result: {
        video: {
          originalName: metadata.title,
          sourceUrl: input.url,
          playbackUrl: metadata.playbackUrl,
          embedUrl: metadata.embedUrl,
          audioPath: audioPath ? path.resolve(audioPath) : undefined
        },
        originalTranscript: [],
        transcript: []
      }
    });
  }
}

function normalizeUploadFilename(filename: string): string {
  try {
    const repaired = Buffer.from(filename, "latin1").toString("utf8");
    if (looksLikeMojibake(filename) && !looksLikeMojibake(repaired)) {
      return repaired;
    }
  } catch {
    // Keep original below.
  }
  return filename;
}

function looksLikeMojibake(value: string): boolean {
  return /[ÃÂâæåçèéäöü¢£¤¥¦§¨©®¼½¾]/.test(value);
}

function buildDownloadFilename(originalName: string, extension: "txt" | "srt" | "md") {
  const base = path.basename(originalName, path.extname(originalName)) || "transcript";
  return extension === "md" ? `${base}.notes.md` : `${base}.transcript.${extension}`;
}

function contentDisposition(filename: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function buildNotesMarkdown(job: JobRecord): string {
  const result = job.result;
  if (!result) {
    return "";
  }

  const video = result.video;
  const summary = result.summary;
  const lines: Array<string | undefined> = [
    "---",
    `title: ${yamlString(video.originalName)}`,
    `created: ${job.createdAt}`,
    `source: ${yamlString(video.sourceUrl ?? "")}`,
    "tags:",
    "  - BiliNote",
    "---",
    "",
    `# ${video.originalName}`,
    "",
    `- 创建时间：${job.createdAt}`,
    video.sourceUrl ? `- 视频链接：${video.sourceUrl}` : undefined,
    `- 转录段落：${result.transcript.length}`,
    "",
    ...summaryMarkdown(summary),
    "",
    "## 转录",
    "",
    ...result.transcript.map((segment) => `- [${segment.timestamp}] ${segment.text}`)
  ];

  return `${lines.filter((line): line is string => line !== undefined).join("\n")}\n`;
}

function summaryMarkdown(summary?: KnowledgeSummary): string[] {
  if (!summary) {
    return ["## 笔记", "", "暂无总结内容。"];
  }

  return [
    "## 概览",
    "",
    summary.overview || "暂无概览。",
    "",
    "## 核心结论",
    "",
    ...markdownList(summary.coreConclusions),
    "",
    "## 知识点",
    "",
    ...summary.knowledgeTree.flatMap((item) => [
      `### ${item.topic || "未命名知识点"}`,
      "",
      ...markdownList(item.points),
      ""
    ]),
    "## 逻辑脉络",
    "",
    ...summary.logicFlow.map((item) => `- **${item.title || "Step"}**：${item.explanation}`),
    "",
    "## 时间轴",
    "",
    ...summary.timelineNotes.map((item) => `- [${item.timestamp || "--:--"}] ${item.note}`),
    "",
    "## 术语",
    "",
    ...summary.terms.map((item) => `- **${item.term}**：${item.definition}`),
    "",
    "## 复习问题",
    "",
    ...markdownList(summary.reviewQuestions)
  ];
}

function markdownList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["暂无内容。"];
}

function buildMarkdownFilename(job: JobRecord): string {
  const date = job.createdAt.slice(0, 10);
  const title = sanitizePathSegment(job.result?.video.originalName ?? "BiliNote");
  return `${date} ${title}.md`;
}

function sanitizeRelativePath(value: string): string {
  return value
    .split(/[\\/]+/)
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean)
    .join(path.sep);
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

interface ProcessedVideoCache {
  originalTranscript: TranscriptSegment[];
  transcript: TranscriptSegment[];
  summary?: Awaited<ReturnType<typeof summarizeKnowledgeTranscript>>;
}

interface OnlineVideoMetadata {
  title: string;
  playbackUrl?: string;
  embedUrl?: string;
  audioUrl?: string;
  pageUrl?: string;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function readProcessedVideoCache(hash: string): Promise<ProcessedVideoCache | undefined> {
  try {
    const raw = await readFile(processedVideoCachePath(hash), "utf8");
    const parsed = JSON.parse(raw) as ProcessedVideoCache;
    if (Array.isArray(parsed.transcript) && parsed.transcript.length > 0) {
      return parsed;
    }
  } catch {
    // Cache misses and stale cache files both fall through to normal processing.
  }
  return undefined;
}

async function writeProcessedVideoCache(hash: string, cache: ProcessedVideoCache) {
  await writeFile(
    processedVideoCachePath(hash),
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        ...cache
      },
      null,
      2
    )
  );
}

function processedVideoCachePath(hash: string) {
  return path.join(processedCacheDir, `${hash}.json`);
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed;
    }
  } catch {
    // Invalid URLs are handled by the caller.
  }
  return undefined;
}

async function resolveOnlineVideoMetadata(url: string): Promise<OnlineVideoMetadata> {
  const direct = isDirectVideoUrl(url);
  if (direct) {
    return {
      title: onlineFilenameFromUrl(url),
      playbackUrl: url,
      embedUrl: undefined,
      audioUrl: url,
      pageUrl: url
    };
  }

  const bilibiliEmbed = await resolveBilibiliEmbed(url);
  if (bilibiliEmbed) {
    return bilibiliEmbed;
  }

  const youtubeMetadata = await resolveYoutubeMetadata(url);
  if (youtubeMetadata) {
    return youtubeMetadata;
  }

  const embedUrl = buildGenericEmbedUrl(url);
  return {
    title: onlineFilenameFromUrl(url),
    playbackUrl: undefined,
    embedUrl,
    pageUrl: url
  };
}

async function resolveBilibiliEmbed(url: string): Promise<OnlineVideoMetadata | undefined> {
  if (!/bilibili\.com|b23\.tv/i.test(url)) {
    return undefined;
  }

  try {
    const video = await fetchVideoInfo(url);
    const audioUrl = await fetchBilibiliAudioUrl(video);
    const params = new URLSearchParams({
      bvid: video.bvid,
      cid: String(video.cid),
      page: "1",
      high_quality: "1",
      autoplay: "0"
    });
    return {
      title: video.title,
      embedUrl: `https://player.bilibili.com/player.html?${params.toString()}`,
      audioUrl,
      pageUrl: video.pageUrl
    };
  } catch {
    return {
      title: onlineFilenameFromUrl(url),
      embedUrl: buildGenericEmbedUrl(url),
      pageUrl: url
    };
  }
}

function buildGenericEmbedUrl(url: string): string | undefined {
  const youtubeId = extractYoutubeId(url);
  if (youtubeId) {
    return `https://www.youtube.com/embed/${youtubeId}`;
  }
  return undefined;
}

async function resolveYoutubeMetadata(url: string): Promise<OnlineVideoMetadata | undefined> {
  const youtubeId = extractYoutubeId(url);
  if (!youtubeId) {
    return undefined;
  }

  return {
    title: (await fetchYoutubeOEmbedTitle(url)) ?? onlineFilenameFromUrl(url),
    embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
    pageUrl: url
  };
}

async function fetchYoutubeOEmbedTitle(url: string): Promise<string | undefined> {
  try {
    const oembedUrl = new URL("https://www.youtube.com/oembed");
    oembedUrl.searchParams.set("url", url);
    oembedUrl.searchParams.set("format", "json");
    const response = await fetch(oembedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as { title?: unknown };
    return typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function extractYoutubeId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (/youtu\.be$/i.test(parsed.hostname)) {
      return parsed.pathname.split("/").filter(Boolean)[0];
    }
    if (/youtube\.com$/i.test(parsed.hostname) || /youtube\.com$/i.test(parsed.hostname.replace(/^www\./, ""))) {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "shorts" || pathParts[0] === "embed" || pathParts[0] === "live") {
        return pathParts[1];
      }
      return parsed.searchParams.get("v") ?? undefined;
    }
  } catch {
    // Keep the original URL as the source of truth.
  }
  return undefined;
}

function onlineFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const basename = decodeURIComponent(path.basename(parsed.pathname));
    return basename && basename !== "/" ? basename : parsed.hostname;
  } catch {
    return "在线视频";
  }
}

function buildOnlineVideoError(error: unknown): string {
  const message = error instanceof Error ? error.message : "处理失败";
  if (/yt-dlp|ENOENT/i.test(message)) {
    return "无法从该网页读取音频。请安装 yt-dlp，或设置 ONLINE_VIDEO_DOWNLOADER_BIN_PATH 后重试；直链 mp4/webm 可不依赖 yt-dlp。";
  }
  return message;
}

function estimateDuration(segments: TranscriptSegment[]): number {
  return segments.reduce((duration, segment) => Math.max(duration, segment.end ?? segment.start), 0);
}

function videoContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    default:
      return "video/mp4";
  }
}
