import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type JobStatus =
  | "queued"
  | "extracting_audio"
  | "transcribing"
  | "summarizing"
  | "done"
  | "failed";

export interface TranscriptSegment {
  start: number;
  end?: number;
  timestamp: string;
  text: string;
}

export interface KnowledgeSummary {
  overview: string;
  coreConclusions: string[];
  knowledgeTree: Array<{
    topic: string;
    points: string[];
  }>;
  logicFlow: Array<{
    title: string;
    explanation: string;
  }>;
  timelineNotes: Array<{
    timestamp: string;
    note: string;
  }>;
  terms: Array<{
    term: string;
    definition: string;
  }>;
  reviewQuestions: string[];
  model: string;
}

export type TranscriptSource = "manual" | "subtitle" | "whisper" | "cache";

export interface JobResult {
  video: {
    originalName: string;
    sourceUrl?: string;
    playbackUrl?: string;
    embedUrl?: string;
    storedPath?: string;
    subtitlePath?: string;
    audioPath?: string;
  };
  transcript: TranscriptSegment[];
  originalTranscript?: TranscriptSegment[];
  summary?: KnowledgeSummary;
  processing?: {
    transcriptSource: TranscriptSource;
    label: string;
    detail?: string;
    whisperModel?: string;
  };
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  result: JobResult | null;
}

const jobStorePath = path.resolve(process.env.JOBS_STORE_PATH || "uploads/jobs.json");
const jobs = loadPersistedJobs();

export function createJob(message = "任务已创建"): JobRecord {
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: randomUUID(),
    status: "queued",
    progress: 0,
    message,
    createdAt: now,
    updatedAt: now,
    error: null,
    result: null
  };
  jobs.set(job.id, job);
  persistJobs();
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

export function listJobs(): JobRecord[] {
  return [...jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function updateJob(id: string, patch: Partial<JobRecord>): JobRecord {
  const job = jobs.get(id);
  if (!job) {
    throw new Error("任务不存在");
  }

  const updated = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  jobs.set(id, updated);
  persistJobs();
  return updated;
}

export function deleteJob(id: string): boolean {
  const deleted = jobs.delete(id);
  if (deleted) {
    persistJobs();
  }
  return deleted;
}

function loadPersistedJobs(): Map<string, JobRecord> {
  if (!existsSync(jobStorePath)) {
    return new Map();
  }

  try {
    const raw = readFileSync(jobStorePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Map();
    }

    const records = parsed.filter(isJobRecord);
    return new Map(records.map((job) => [job.id, job]));
  } catch {
    return new Map();
  }
}

function persistJobs() {
  mkdirSync(path.dirname(jobStorePath), { recursive: true });
  writeFileSync(jobStorePath, JSON.stringify([...jobs.values()], null, 2));
}

function isJobRecord(value: unknown): value is JobRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.status === "string" &&
    typeof record.progress === "number" &&
    typeof record.message === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    (record.error === null || typeof record.error === "string") &&
    (record.result === null || typeof record.result === "object")
  );
}
