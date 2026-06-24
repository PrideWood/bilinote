import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

type JobStatus =
  | "queued"
  | "extracting_audio"
  | "transcribing"
  | "summarizing"
  | "done"
  | "failed";

interface TranscriptSegment {
  start: number;
  end?: number;
  timestamp: string;
  text: string;
}

interface KnowledgeSummary {
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

interface JobRecord {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  result: null | {
    video: {
      originalName: string;
      storedPath?: string;
      audioPath?: string;
    };
    transcript: TranscriptSegment[];
    originalTranscript?: TranscriptSegment[];
    summary?: KnowledgeSummary;
  };
}

interface JobListItem {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  result: null | {
    video: {
      originalName: string;
      storedPath?: string;
      audioPath?: string;
    };
    transcriptCount: number;
    duration: number;
  };
}

const detailTabs = ["笔记", "转录", "知识点"] as const;
type DetailTab = (typeof detailTabs)[number];

export default function App() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("转录");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => void loadJobs(), 2500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }

    let stopped = false;
    async function pollJob() {
      try {
        const response = await fetch(`/api/jobs/${selectedJobId}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "获取任务状态失败");
        }
        if (!stopped) {
          setSelectedJob(payload);
        }
        if (payload.status === "done" || payload.status === "failed") {
          void loadJobs();
          return;
        }
        window.setTimeout(pollJob, 1200);
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : "获取任务状态失败");
        }
      }
    }

    void pollJob();
    return () => {
      stopped = true;
    };
  }, [selectedJobId]);

  async function loadJobs() {
    const response = await fetch("/api/jobs");
    const payload = await response.json();
    if (response.ok) {
      setJobs(payload);
    }
  }

  async function handleVideoUpload(file: File | undefined) {
    if (!file) {
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("manualTranscript", "");
      formData.append("notes", "");

      const response = await fetch("/api/jobs", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "创建任务失败");
      }

      setActiveDetailTab("转录");
      setSelectedJobId(payload.jobId);
      void loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedListItem = jobs.find((item) => item.id === selectedJobId);
  const activeJob = selectedJob ?? selectedListItem;
  const summary = selectedJob?.result?.summary;
  const transcript = selectedJob?.result?.transcript ?? [];
  const statusLabel = formatStatus(activeJob?.status);
  const hasPlayableVideo = Boolean(selectedJob?.id && selectedJob.result?.video.storedPath);
  const filteredJobs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return jobs;
    }
    return jobs.filter((item) =>
      (item.result?.video.originalName ?? "处理中任务").toLowerCase().includes(keyword)
    );
  }, [jobs, query]);

  function openJob(id: string) {
    setError("");
    setActiveDetailTab("转录");
    setSelectedJobId(id);
  }

  function seekTo(seconds: number) {
    const player = videoRef.current;
    if (!player || !Number.isFinite(seconds)) {
      return;
    }
    player.currentTime = Math.max(0, seconds);
    void player.play().catch(() => {
      // Browser autoplay rules can block play; seeking still succeeds.
    });
  }

  return (
    <main className="minutes-app">
      <section className="main-pane">
        {!selectedJobId && (
          <header className="topbar">
            <div className="brand-mark">
              <span>B</span>
              <strong>BiliNote</strong>
            </div>
            <div className="search-box">
              <span>⌕</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索历史视频标题"
                value={query}
              />
            </div>
            <label className={`primary-action ${submitting ? "busy" : ""}`}>
              <input
                accept=".mp4,.mov,.mkv,.webm,video/*"
                disabled={submitting}
                type="file"
                onChange={(event) => {
                  void handleVideoUpload(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              {submitting ? "处理中..." : "Upload"}
            </label>
          </header>
        )}

        {error && <div className="notice error">{error}</div>}

        {selectedJobId ? (
          <DetailView
            activeTab={activeDetailTab}
            hasPlayableVideo={hasPlayableVideo}
            job={selectedJob}
            onBack={() => setSelectedJobId("")}
            onChangeTab={setActiveDetailTab}
            onJobUpdate={setSelectedJob}
            onSeek={seekTo}
            statusLabel={statusLabel}
            summary={summary}
            transcript={transcript}
            videoRef={videoRef}
          />
        ) : (
          <HomeView jobs={filteredJobs} onOpenJob={openJob} />
        )}
      </section>
    </main>
  );
}

function HomeView({
  jobs,
  onOpenJob
}: {
  jobs: JobListItem[];
  onOpenJob: (id: string) => void;
}) {
  return (
    <section className="home-view">
      <div className="list-header">
        <h1>历史视频</h1>
      </div>

      <div className="history-table">
        <div className="table-head">
          <span>视频</span>
          <span>创建时间</span>
          <span>状态</span>
        </div>
        {jobs.length === 0 ? (
          <div className="empty-state">
            <h2>还没有处理过的视频</h2>
            <p>点击右上角 Upload 选择本地视频，完成后会出现在这里。</p>
          </div>
        ) : (
          jobs.map((job) => (
            <button className="history-row" key={job.id} onClick={() => onOpenJob(job.id)} type="button">
              <span className="item-cell">
                <span className="thumbnail">
                  {job.result?.video.storedPath ? (
                    <video muted preload="metadata" src={`/api/jobs/${job.id}/video`} />
                  ) : (
                    <span>{job.progress}%</span>
                  )}
                </span>
                <span>
                  <strong>{job.result?.video.originalName ?? "处理中任务"}</strong>
                  <small>
                    {formatDuration(job.result?.duration ?? 0)}
                    {job.status !== "done" ? ` · ${formatStatus(job.status)} ${job.progress}%` : ""}
                  </small>
                </span>
              </span>
              <span>{formatDate(job.createdAt)}</span>
              <span>{formatStatus(job.status)}{job.status !== "done" ? ` ${job.progress}%` : ""}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function DetailView({
  activeTab,
  hasPlayableVideo,
  job,
  onBack,
  onChangeTab,
  onJobUpdate,
  onSeek,
  statusLabel,
  summary,
  transcript,
  videoRef
}: {
  activeTab: DetailTab;
  hasPlayableVideo: boolean;
  job: JobRecord | null;
  onBack: () => void;
  onChangeTab: (tab: DetailTab) => void;
  onJobUpdate: (job: JobRecord) => void;
  onSeek: (seconds: number) => void;
  statusLabel: string;
  summary?: KnowledgeSummary;
  transcript: TranscriptSegment[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const title = job?.result?.video.originalName ?? "正在加载视频";
  const [exportOpen, setExportOpen] = useState(false);
  const [textQuery, setTextQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [videoWidth, setVideoWidth] = useState(57);
  const [draftTranscript, setDraftTranscript] = useState<TranscriptSegment[]>(transcript);
  const detailGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraftTranscript(transcript);
    }
  }, [editing, transcript]);

  async function saveTranscript() {
    if (!job?.id) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/jobs/${job.id}/transcript`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          segments: draftTranscript.map((segment) => ({ text: segment.text }))
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "保存转录失败");
      }
      onJobUpdate(payload);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    const grid = detailGridRef.current;
    if (!grid) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = grid.getBoundingClientRect();

    function handleMove(moveEvent: PointerEvent) {
      const nextWidth = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setVideoWidth(Math.min(72, Math.max(32, nextWidth)));
    }

    function stopMove() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopMove);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopMove);
  }

  return (
    <section className="detail-view">
      <header className="detail-titlebar">
        <button className="detail-back" onClick={onBack} type="button">
          ‹
        </button>
        <div className="detail-title">
          <h1>{title}</h1>
          <p>
            {formatDate(job?.createdAt)} · {formatDuration(lastTranscriptTime(transcript))} · {statusLabel}
          </p>
        </div>
        {job?.result && (
          <div className="export-menu">
            <button
              aria-label="导出"
              onClick={() => setExportOpen((value) => !value)}
              type="button"
            >
              ⋮
            </button>
            {exportOpen && (
              <div className="export-dropdown">
                <a href={`/api/jobs/${job.id}/transcript.txt`}>导出 TXT</a>
                <a href={`/api/jobs/${job.id}/transcript.srt`}>导出 SRT</a>
              </div>
            )}
          </div>
        )}
      </header>

      <div
        className="detail-grid"
        ref={detailGridRef}
        style={{
          "--video-width": `${videoWidth}%`
        } as CSSProperties}
      >
        <section className="video-column">
          {hasPlayableVideo ? (
            <video controls preload="metadata" ref={videoRef} src={`/api/jobs/${job?.id}/video`} />
          ) : (
            <div className="video-placeholder">
              {job?.status === "done" ? "当前任务没有可播放的视频文件" : `${statusLabel} ${job?.progress ?? 0}%`}
            </div>
          )}
          <div className="video-meta-panel">
            <span>{formatDuration(lastTranscriptTime(transcript))}</span>
            <span>{transcript.length} 段转录</span>
            <span>{statusLabel}</span>
          </div>
        </section>

        <div
          aria-label="调整视频和文本区域宽度"
          className="resize-handle"
          onPointerDown={startResize}
          role="separator"
        />

        <aside className="transcript-column">
          <div className="content-toolbar">
            <div className="detail-tabs">
              {detailTabs.map((tab) => (
                <button
                  className={activeTab === tab ? "active" : ""}
                  key={tab}
                  onClick={() => onChangeTab(tab)}
                  type="button"
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="text-tools">
              <div className="content-search">
                <span>⌕</span>
                <input
                  onChange={(event) => setTextQuery(event.target.value)}
                  placeholder="搜索文本内容"
                  value={textQuery}
                />
              </div>
              {activeTab === "转录" && (
                editing ? (
                  <div className="edit-actions">
                    <button
                      className="ghost-button"
                      disabled={saving}
                      onClick={() => {
                        setDraftTranscript(transcript);
                        setEditing(false);
                      }}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="edit-button"
                      disabled={saving}
                      onClick={() => void saveTranscript()}
                      type="button"
                    >
                      {saving ? "保存中" : "保存"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="edit-button"
                    disabled={transcript.length === 0}
                    onClick={() => setEditing(true)}
                    type="button"
                  >
                    编辑
                  </button>
                )
              )}
            </div>
          </div>

          {activeTab === "转录" && (
            <TranscriptPane
              editing={editing}
              onChangeDraft={setDraftTranscript}
              onSeek={onSeek}
              query={textQuery}
              transcript={editing ? draftTranscript : transcript}
            />
          )}
          {activeTab === "笔记" && <NotesPane summary={summary} />}
          {activeTab === "知识点" && (
            <KnowledgePane onSeek={onSeek} summary={summary} transcript={transcript} />
          )}
        </aside>
      </div>
    </section>
  );
}

function TranscriptPane({
  editing,
  onChangeDraft,
  onSeek,
  query,
  transcript
}: {
  editing: boolean;
  onChangeDraft: (segments: TranscriptSegment[]) => void;
  onSeek: (seconds: number) => void;
  query: string;
  transcript: TranscriptSegment[];
}) {
  if (transcript.length === 0) {
    return <div className="empty-state compact-empty">暂无 transcript</div>;
  }

  const keyword = query.trim().toLowerCase();
  const visibleTranscript = keyword
    ? transcript.filter(
        (item) =>
          item.text.toLowerCase().includes(keyword) || item.timestamp.toLowerCase().includes(keyword)
      )
    : transcript;

  return (
    <div className="transcript-stream">
      {visibleTranscript.length === 0 ? (
        <div className="empty-state compact-empty">没有匹配的转录文本</div>
      ) : (
        visibleTranscript.slice(0, 500).map((item) => {
          const originalIndex = transcript.findIndex(
            (segment) => segment.start === item.start && segment.timestamp === item.timestamp
          );

          return editing ? (
            <div className="minute-line editing-line" key={`${item.timestamp}-${item.start}`}>
              <button onClick={() => onSeek(item.start)} type="button">
                {item.timestamp}
              </button>
              <textarea
                value={item.text}
                onChange={(event) => {
                  const next = [...transcript];
                  next[originalIndex] = {
                    ...next[originalIndex],
                    text: event.target.value
                  };
                  onChangeDraft(next);
                }}
              />
            </div>
          ) : (
            <button
              className="minute-line"
              key={`${item.timestamp}-${item.start}`}
              onClick={() => onSeek(item.start)}
              type="button"
            >
              <time>{item.timestamp}</time>
              <span className="line-content">
                <span className="line-text">{item.text}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function NotesPane({ summary }: { summary?: KnowledgeSummary }) {
  if (!summary) {
    return <div className="empty-state compact-empty">总结生成后会显示在这里</div>;
  }

  return (
    <div className="notes-stream">
      <article>
        <h2>概览</h2>
        <p>{summary.overview}</p>
      </article>
      <article>
        <h2>核心结论</h2>
        <List items={summary.coreConclusions} />
      </article>
      <article>
        <h2>逻辑脉络</h2>
        {summary.logicFlow.map((item, index) => (
          <p key={`${item.title}-${index}`}>
            <strong>{item.title || `Step ${index + 1}`}</strong>：{item.explanation}
          </p>
        ))}
      </article>
    </div>
  );
}

function KnowledgePane({
  onSeek,
  summary,
  transcript
}: {
  onSeek: (seconds: number) => void;
  summary?: KnowledgeSummary;
  transcript: TranscriptSegment[];
}) {
  if (!summary) {
    return <div className="empty-state compact-empty">知识点生成后会显示在这里</div>;
  }

  return (
    <div className="notes-stream">
      {summary.knowledgeTree.map((item, index) => (
        <article key={`${item.topic}-${index}`}>
          <h2>{item.topic || `知识点 ${index + 1}`}</h2>
          <TimedList items={item.points} onSeek={onSeek} transcript={transcript} />
        </article>
      ))}
      <article>
        <h2>时间轴</h2>
        <div className="timeline-list">
          {summary.timelineNotes.map((item, index) => (
            <button
              key={`${item.timestamp}-${index}`}
              onClick={() => onSeek(timestampToSeconds(item.timestamp))}
              type="button"
            >
              <time>{item.timestamp || "--:--"}</time>
              <span>{item.note}</span>
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="muted">暂无内容</p>;
  }
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function TimedList({
  items,
  onSeek,
  transcript
}: {
  items: string[];
  onSeek: (seconds: number) => void;
  transcript: TranscriptSegment[];
}) {
  if (items.length === 0) {
    return <p className="muted">暂无内容</p>;
  }

  return (
    <ul className="timed-list">
      {items.map((item, index) => {
        const timestamp = extractTimestamp(item);
        const matchedSegment = timestamp ? undefined : findBestSegment(item, transcript);
        const seconds = timestamp ? timestampToSeconds(timestamp) : matchedSegment?.start;
        const label = timestamp ?? matchedSegment?.timestamp;

        return (
          <li key={`${item}-${index}`}>
            {typeof seconds === "number" ? (
              <button onClick={() => onSeek(seconds)} type="button">
                <time>{label}</time>
                <span>{stripLeadingTimestamp(item)}</span>
              </button>
            ) : (
              stripLeadingTimestamp(item)
            )}
          </li>
        );
      })}
    </ul>
  );
}

function extractTimestamp(text: string): string | undefined {
  return text.match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/)?.[0];
}

function stripLeadingTimestamp(text: string): string {
  return text.replace(/^\s*\[?(?:\d{1,2}:)?\d{1,2}:\d{2}\]?\s*[-:：]?\s*/, "");
}

function timestampToSeconds(timestamp: string): number {
  const parts = timestamp
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function findBestSegment(text: string, transcript: TranscriptSegment[]): TranscriptSegment | undefined {
  const query = tokenize(stripLeadingTimestamp(text));
  if (query.length === 0) {
    return undefined;
  }

  let best: { score: number; segment: TranscriptSegment } | undefined;
  for (const segment of transcript) {
    const tokens = tokenize(segment.text);
    if (tokens.length === 0) {
      continue;
    }
    const overlap = query.filter((token) => tokens.includes(token)).length;
    const score = overlap / Math.sqrt(query.length * tokens.length);
    if (!best || score > best.score) {
      best = { score, segment };
    }
  }

  return best && best.score >= 0.16 ? best.segment : undefined;
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
  const cjk = normalized.match(/[\u4e00-\u9fff]/gu) ?? [];
  const words = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  return [...cjk, ...words];
}

function lastTranscriptTime(transcript: TranscriptSegment[]) {
  return transcript.reduce((duration, segment) => Math.max(duration, segment.end ?? segment.start), 0);
}

function formatDuration(seconds: number) {
  if (!seconds) {
    return "0min";
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}min ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}min ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function formatDate(value?: string) {
  if (!value) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatStatus(status?: JobStatus) {
  switch (status) {
    case "queued":
      return "排队中";
    case "extracting_audio":
      return "提取音频中";
    case "transcribing":
      return "转写中";
    case "summarizing":
      return "总结中";
    case "done":
      return "完成";
    case "failed":
      return "失败";
    default:
      return "未开始";
  }
}
