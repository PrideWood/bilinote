import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
export const videoUploadDir = path.join(uploadRoot, "videos");
export const audioOutputDir = path.join(uploadRoot, "audio");
export const transcriptOutputDir = path.join(uploadRoot, "transcripts");
export const processedCacheDir = path.join(uploadRoot, "cache");

export async function ensureStorageDirs() {
  await Promise.all([
    mkdir(videoUploadDir, { recursive: true }),
    mkdir(audioOutputDir, { recursive: true }),
    mkdir(transcriptOutputDir, { recursive: true }),
    mkdir(processedCacheDir, { recursive: true })
  ]);
}

export function isSupportedVideo(filename: string): boolean {
  return [".mp4", ".mov", ".mkv", ".webm"].includes(path.extname(filename).toLowerCase());
}

export function isDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return [".mp4", ".mov", ".mkv", ".webm"].includes(path.extname(parsed.pathname).toLowerCase());
  } catch {
    return false;
  }
}

export async function extractAudio(videoPath: string, jobId: string): Promise<string> {
  await ensureStorageDirs();
  const audioPath = path.join(audioOutputDir, `${jobId}.wav`);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    audioPath
  ]);

  return audioPath;
}

export async function extractAudioFromUrl(
  url: string,
  jobId: string,
  referer = "https://www.bilibili.com/"
): Promise<string> {
  await ensureStorageDirs();
  const audioPath = path.join(audioOutputDir, `${jobId}.wav`);

  await execFileAsync("ffmpeg", [
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
  ]);

  return audioPath;
}

export async function downloadAudioFromOnlineVideo(url: string, jobId: string): Promise<string> {
  await ensureStorageDirs();
  const downloaderBin = process.env.ONLINE_VIDEO_DOWNLOADER_BIN_PATH || "yt-dlp";
  const outputTemplate = path.join(audioOutputDir, `${jobId}.%(ext)s`);
  const outputPath = path.join(audioOutputDir, `${jobId}.wav`);

  await execFileAsync(downloaderBin, [
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
  ]);

  return outputPath;
}
