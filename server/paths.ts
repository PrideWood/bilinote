import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const appName = "BiliNote AI";
const projectRoot = process.cwd();

export const appDataDir = path.resolve(process.env.BILINOTE_DATA_DIR || process.env.APP_DATA_DIR || defaultAppDataDir());
export const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(appDataDir, "uploads"));
export const videoUploadDir = path.join(uploadRoot, "videos");
export const audioOutputDir = path.join(uploadRoot, "audio");
export const transcriptOutputDir = path.join(uploadRoot, "transcripts");
export const subtitleOutputDir = path.join(uploadRoot, "subtitles");
export const processedCacheDir = path.join(uploadRoot, "cache");
export const whisperModelsDir = path.resolve(process.env.WHISPER_MODELS_DIR || path.join(appDataDir, "models"));
export const defaultWhisperModelPath = path.resolve(
  process.env.WHISPER_MODEL_PATH || path.join(whisperModelsDir, "ggml-large-v3-turbo.bin")
);
export const jobStorePath = path.resolve(process.env.JOBS_STORE_PATH || path.join(appDataDir, "jobs.json"));
export const logsDir = path.join(appDataDir, "logs");

migrateLegacyDataSync();

function defaultAppDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), appName);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "bilinote-ai");
}

function migrateLegacyDataSync() {
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  copyLegacyDirectoryIfUseful(path.join(projectRoot, "uploads"), uploadRoot);
  copyLegacyDirectoryIfUseful(path.join(projectRoot, "models"), whisperModelsDir);
  migrateLegacyJobStore();
}

function copyLegacyDirectoryIfUseful(source: string, target: string) {
  if (!existsSync(source) || path.resolve(source) === path.resolve(target)) {
    return;
  }
  if (existsSync(target) && directoryHasEntries(target)) {
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    cpSync(source, target, { recursive: true, errorOnExist: false, force: false });
  } catch {
    // A failed best-effort migration should not block the service from starting.
  }
}

function migrateLegacyJobStore() {
  if (existsSync(jobStorePath)) {
    return;
  }

  const legacyJobStorePath = path.join(projectRoot, "uploads", "jobs.json");
  if (!existsSync(legacyJobStorePath)) {
    mkdirSync(path.dirname(jobStorePath), { recursive: true });
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(legacyJobStorePath, "utf8")) as unknown;
    const migrated = rewriteLegacyPaths(parsed);
    mkdirSync(path.dirname(jobStorePath), { recursive: true });
    writeFileSync(jobStorePath, JSON.stringify(migrated, null, 2));
  } catch {
    // Leave an unreadable legacy store alone; the jobs module will start empty.
  }
}

function rewriteLegacyPaths(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(rewriteLegacyPaths);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, rewriteLegacyPaths(nestedValue)])
    );
  }
  if (typeof value !== "string") {
    return value;
  }

  return rewriteOneLegacyPath(value);
}

function rewriteOneLegacyPath(value: string) {
  const legacyUploadRoot = path.resolve(projectRoot, "uploads");
  const legacyModelsRoot = path.resolve(projectRoot, "models");
  const resolved = path.resolve(projectRoot, value);

  if (resolved === legacyUploadRoot || resolved.startsWith(`${legacyUploadRoot}${path.sep}`)) {
    return path.join(uploadRoot, path.relative(legacyUploadRoot, resolved));
  }
  if (resolved === legacyModelsRoot || resolved.startsWith(`${legacyModelsRoot}${path.sep}`)) {
    return path.join(whisperModelsDir, path.relative(legacyModelsRoot, resolved));
  }
  return value;
}

function directoryHasEntries(dir: string) {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}
