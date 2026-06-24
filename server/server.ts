import cors from "cors";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildTranscript,
  fetchSubtitleLines,
  fetchVideoInfo,
  isTranscriptRelevantToTitle,
  transcriptToText
} from "./bilibili.js";
import { createJob, getJob, listJobs, updateJob, type TranscriptSegment } from "./jobs.js";
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
  extractAudio,
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

app.get("/api/jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "任务不存在" });
  }
  return res.json(job);
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

function buildDownloadFilename(originalName: string, extension: "txt" | "srt") {
  const base = path.basename(originalName, path.extname(originalName)) || "transcript";
  return `${base}.transcript.${extension}`;
}

function contentDisposition(filename: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

interface ProcessedVideoCache {
  originalTranscript: TranscriptSegment[];
  transcript: TranscriptSegment[];
  summary?: Awaited<ReturnType<typeof summarizeKnowledgeTranscript>>;
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
