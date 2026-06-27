import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
export const videoUploadDir = path.join(uploadRoot, "videos");
export const audioOutputDir = path.join(uploadRoot, "audio");
export const transcriptOutputDir = path.join(uploadRoot, "transcripts");
export const subtitleOutputDir = path.join(uploadRoot, "subtitles");
export const processedCacheDir = path.join(uploadRoot, "cache");

export async function ensureStorageDirs() {
  await Promise.all([
    mkdir(videoUploadDir, { recursive: true }),
    mkdir(audioOutputDir, { recursive: true }),
    mkdir(transcriptOutputDir, { recursive: true }),
    mkdir(subtitleOutputDir, { recursive: true }),
    mkdir(processedCacheDir, { recursive: true })
  ]);
}

export function isSupportedVideo(filename: string): boolean {
  return [".mp4", ".mov", ".mkv", ".webm"].includes(path.extname(filename).toLowerCase());
}

export function isSupportedSubtitle(filename: string): boolean {
  return [".srt", ".vtt"].includes(path.extname(filename).toLowerCase());
}

export function isDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return [".mp4", ".mov", ".mkv", ".webm"].includes(path.extname(parsed.pathname).toLowerCase());
  } catch {
    return false;
  }
}

export async function extractAudio(
  videoPath: string,
  jobId: string,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  await ensureStorageDirs();
  const audioPath = path.join(audioOutputDir, `${jobId}.wav`);

  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", audioPath],
    { signal: options.signal }
  );

  return audioPath;
}

export async function extractEmbeddedSubtitle(
  videoPath: string,
  jobId: string,
  options: { signal?: AbortSignal } = {}
): Promise<string | undefined> {
  await ensureStorageDirs();
  const subtitlePath = path.join(subtitleOutputDir, `${jobId}.embedded.srt`);

  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", videoPath, "-map", "0:s:0", "-c:s", "srt", subtitlePath],
      { signal: options.signal }
    );
  } catch {
    return undefined;
  }

  try {
    if ((await readFile(subtitlePath, "utf8")).trim()) {
      return subtitlePath;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function extractAudioFromUrl(
  url: string,
  jobId: string,
  referer = "https://www.bilibili.com/",
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  await ensureStorageDirs();
  const audioPath = path.join(audioOutputDir, `${jobId}.wav`);

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-headers",
      `User-Agent: Mozilla/5.0\r\nReferer: ${referer}\r\n`,
      "-i",
      url,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      audioPath
    ],
    { signal: options.signal }
  );

  return audioPath;
}

export async function downloadAudioFromOnlineVideo(
  url: string,
  jobId: string,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  await ensureStorageDirs();
  const downloaderBin = process.env.ONLINE_VIDEO_DOWNLOADER_BIN_PATH || "yt-dlp";
  const outputTemplate = path.join(audioOutputDir, `${jobId}.%(ext)s`);
  const outputPath = path.join(audioOutputDir, `${jobId}.wav`);

  await execFileAsync(
    downloaderBin,
    [
      "--no-playlist",
      "--extract-audio",
      "--audio-format",
      "wav",
      "--audio-quality",
      "0",
      "--postprocessor-args",
      "ffmpeg:-ac 1 -ar 16000",
      "-o",
      outputTemplate,
      url
    ],
    { signal: options.signal }
  );

  return outputPath;
}

export async function downloadSubtitleFromOnlineVideo(
  url: string,
  jobId: string,
  options: { signal?: AbortSignal; title?: string } = {}
): Promise<string | undefined> {
  await ensureStorageDirs();
  const downloaderBin = process.env.ONLINE_VIDEO_DOWNLOADER_BIN_PATH || "yt-dlp";
  const outputTemplate = path.join(subtitleOutputDir, `${jobId}.%(ext)s`);
  const subtitleLangs = resolveOnlineSubtitleLangs(options.title);

  try {
    await execFileAsync(
      downloaderBin,
      [
        "--no-playlist",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        subtitleLangs,
        "--sub-format",
        "srt/vtt/best",
        "-o",
        outputTemplate,
        url
      ],
      { signal: options.signal }
    );
  } catch {
    return undefined;
  }

  const candidates = (await readdir(subtitleOutputDir))
    .filter((filename) => filename.startsWith(`${jobId}.`) && /\.(srt|vtt)$/i.test(filename))
    .sort((left, right) => subtitlePriority(left, subtitleLangs) - subtitlePriority(right, subtitleLangs));

  for (const filename of candidates) {
    const sourcePath = path.join(subtitleOutputDir, filename);
    if ((await readFile(sourcePath, "utf8")).trim()) {
      return sourcePath;
    }
  }

  return undefined;
}

function resolveOnlineSubtitleLangs(title?: string): string {
  const configured = process.env.ONLINE_SUBTITLE_LANGS?.trim();
  if (configured) {
    return configured;
  }

  switch (inferLanguageFromTitle(title ?? "")) {
    case "zh":
      return "zh-CN,zh-Hans,zh,en.*,en";
    case "ja":
      return "ja,ja.*,en.*,en,zh-CN,zh-Hans,zh";
    case "ko":
      return "ko,ko.*,en.*,en,zh-CN,zh-Hans,zh";
    case "en":
      return "en.*,en,zh-CN,zh-Hans,zh";
    default:
      return "en.*,en,zh-CN,zh-Hans,zh";
  }
}

function inferLanguageFromTitle(title: string): "zh" | "ja" | "ko" | "en" | "unknown" {
  const text = title.trim();
  if (!text) {
    return "unknown";
  }

  const zhCount = countMatches(text, /[\u4e00-\u9fff]/g);
  const jaCount = countMatches(text, /[\u3040-\u30ff]/g);
  const koCount = countMatches(text, /[\uac00-\ud7af]/g);
  if (jaCount > 0 && jaCount >= zhCount) {
    return "ja";
  }
  if (koCount > 0) {
    return "ko";
  }
  if (zhCount > 0) {
    return "zh";
  }

  const latinCount = countMatches(text, /[A-Za-z]/g);
  if (latinCount >= Math.max(6, Math.ceil(text.length * 0.35))) {
    return "en";
  }

  return "unknown";
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function subtitlePriority(filename: string, subtitleLangs: string): number {
  const priorities = subtitleLangs
    .split(",")
    .map((lang) => lang.trim())
    .filter(Boolean);
  const index = priorities.findIndex((lang) => subtitleFilenameMatchesLang(filename, lang));
  return index >= 0 ? index : priorities.length;
}

function subtitleFilenameMatchesLang(filename: string, lang: string): boolean {
  const escaped = escapeRegExp(lang.replace(/\.\*$/, ""));
  if (!escaped) {
    return false;
  }
  return new RegExp(`(^|[._-])${escaped}([._-]|$)`, "i").test(filename);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
