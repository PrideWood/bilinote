import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  audioOutputDir,
  processedCacheDir,
  subtitleOutputDir,
  transcriptOutputDir,
  uploadRoot,
  videoUploadDir
} from "./paths.js";

const execFileAsync = promisify(execFile);
const ffmpegBin = process.env.FFMPEG_BIN_PATH || "ffmpeg";
export { audioOutputDir, processedCacheDir, subtitleOutputDir, transcriptOutputDir, uploadRoot, videoUploadDir };

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
    ffmpegBin,
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
      ffmpegBin,
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
    ffmpegBin,
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
  options: { signal?: AbortSignal } = {}
): Promise<string | undefined> {
  await ensureStorageDirs();
  const downloaderBin = process.env.ONLINE_VIDEO_DOWNLOADER_BIN_PATH || "yt-dlp";
  const outputTemplate = path.join(subtitleOutputDir, `${jobId}.%(ext)s`);

  try {
    await execFileAsync(
      downloaderBin,
      [
        "--no-playlist",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        process.env.ONLINE_SUBTITLE_LANGS || "zh-CN,zh-Hans,zh,en.*,en",
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
    .sort((left, right) => subtitlePriority(left) - subtitlePriority(right));

  for (const filename of candidates) {
    const sourcePath = path.join(subtitleOutputDir, filename);
    if ((await readFile(sourcePath, "utf8")).trim()) {
      return sourcePath;
    }
  }

  return undefined;
}

function subtitlePriority(filename: string): number {
  if (/zh-CN|zh-Hans|\.zh\./i.test(filename)) {
    return 0;
  }
  if (/zh/i.test(filename)) {
    return 1;
  }
  if (/en/i.test(filename)) {
    return 2;
  }
  return 3;
}
