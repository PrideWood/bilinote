import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TranscriptSegment } from "./jobs.js";
import { transcriptOutputDir } from "./video.js";

const execFileAsync = promisify(execFile);

export async function transcribeAudio(
  audioPath: string,
  jobId: string,
  options: { modelPath?: string; signal?: AbortSignal } = {}
): Promise<TranscriptSegment[]> {
  const whisperBin = process.env.WHISPER_BIN_PATH || "whisper-cli";
  const modelPath = options.modelPath || process.env.WHISPER_MODEL_PATH || "./models/ggml-large-v3-turbo.bin";
  const language = process.env.WHISPER_LANGUAGE || "zh";

  await assertExecutable(whisperBin, "未找到 whisper-cli，请设置 WHISPER_BIN_PATH。");
  await assertReadable(modelPath, "未找到 Whisper 模型文件，请设置 WHISPER_MODEL_PATH。");
  await assertNonEmptyAudio(audioPath);

  const outputBase = path.join(transcriptOutputDir, jobId);
  await execFileAsync(
    whisperBin,
    ["-m", modelPath, "-f", audioPath, "-l", language, "-otxt", "-osrt", "-of", outputBase],
    { signal: options.signal }
  );

  const srtPath = `${outputBase}.srt`;
  const txtPath = `${outputBase}.txt`;
  try {
    const srt = await readFile(srtPath, "utf8");
    const segments = parseSrt(srt);
    if (segments.length > 0) {
      return segments;
    }
  } catch {
    // Fall back to txt below.
  }

  const text = await readFile(txtPath, "utf8");
  return parsePlainTranscript(text);
}

export function parsePlainTranscript(text: string): TranscriptSegment[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      start: index,
      timestamp: formatTimestamp(index),
      text: line.replace(/^\[[^\]]+\]\s*/, "")
    }));
}

export function parseSubtitleText(text: string): TranscriptSegment[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.includes("-->")) {
    return parseTimedSubtitle(normalized);
  }
  return parsePlainTranscript(normalized);
}

export function transcriptSegmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `[${segment.timestamp}] ${segment.text}`).join("\n");
}

export function mergeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | undefined;

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }

    if (!current) {
      current = { ...segment, text };
      continue;
    }

    const gap = segment.start - (current.end ?? current.start);
    const duration = (current.end ?? current.start) - current.start;
    const shouldMerge =
      gap <= 1.2 &&
      duration <= 12 &&
      current.text.length <= 80 &&
      !endsWithStrongPunctuation(current.text);

    if (shouldMerge) {
      current = {
        start: current.start,
        end: segment.end ?? segment.start,
        timestamp: current.timestamp,
        text: joinTranscriptText(current.text, text)
      };
    } else {
      merged.push(current);
      current = { ...segment, text };
    }
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

export function segmentsToTxt(segments: TranscriptSegment[]): string {
  return `${transcriptSegmentsToText(segments)}\n`;
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment, index) =>
      [
        String(index + 1),
        `${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end ?? segment.start + 2)}`,
        segment.text,
        ""
      ].join("\n")
    )
    .join("\n");
}

async function assertReadable(filePath: string, message: string) {
  try {
    await access(filePath);
  } catch {
    throw new Error(message);
  }
}

async function assertExecutable(command: string, message: string) {
  if (command.includes("/") || path.isAbsolute(command)) {
    await assertReadable(command, message);
    return;
  }

  try {
    await execFileAsync("which", [command]);
  } catch {
    throw new Error(message);
  }
}

async function assertNonEmptyAudio(audioPath: string) {
  const info = await stat(audioPath);
  if (info.size < 1024) {
    throw new Error("音频文件为空或过短，无法转写。请确认视频包含可用音轨。");
  }
}

function parseSrt(srt: string): TranscriptSegment[] {
  return parseTimedSubtitle(srt);
}

function parseTimedSubtitle(srt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const block of srt.split(/\n\s*\n/)) {
    const lines = block.trim().split(/\n/);
    const timeLine = lines.find((line) => line.includes("-->"));
    if (!timeLine) {
      continue;
    }

    const [startRaw, endRaw] = timeLine.split("-->").map((item) => item.trim());
    const text = lines
      .slice(lines.indexOf(timeLine) + 1)
      .map((line) => cleanSubtitleText(line))
      .join(" ")
      .trim();
    if (!text) {
      continue;
    }

    const start = parseSrtTimestamp(startRaw);
    segments.push({
      start,
      end: parseSrtTimestamp(endRaw),
      timestamp: formatTimestamp(start),
      text
    });
  }
  return segments;
}

function parseSrtTimestamp(value: string): number {
  const match = value.match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
  if (!match) {
    return 0;
  }
  const [, hours = "0", minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}

function cleanSubtitleText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatSrtTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    wholeSeconds
  ).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function endsWithStrongPunctuation(text: string): boolean {
  return /[。！？!?；;]$/.test(text.trim());
}

function joinTranscriptText(left: string, right: string): string {
  if (/^[,，.。!?！？;；:：]/.test(right)) {
    return `${left}${right}`;
  }
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`;
  }
  if (/[\u4e00-\u9fff]$/.test(left) && /^[\u4e00-\u9fff]/.test(right)) {
    return `${left}，${right}`;
  }
  return `${left}${right}`;
}
