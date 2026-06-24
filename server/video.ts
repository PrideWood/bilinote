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
