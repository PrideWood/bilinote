import { randomUUID } from "node:crypto";

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

export interface JobResult {
  video: {
    originalName: string;
    storedPath?: string;
    audioPath?: string;
  };
  transcript: TranscriptSegment[];
  originalTranscript?: TranscriptSegment[];
  summary?: KnowledgeSummary;
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

const jobs = new Map<string, JobRecord>();

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
  return updated;
}
