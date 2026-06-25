import {
  type CSSProperties,
  type FormEvent,
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
      sourceUrl?: string;
      playbackUrl?: string;
      embedUrl?: string;
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
      sourceUrl?: string;
      playbackUrl?: string;
      embedUrl?: string;
      storedPath?: string;
      audioPath?: string;
    };
    transcriptCount: number;
    duration: number;
  };
}

const detailTabs = ["笔记", "转录", "知识点"] as const;
type DetailTab = (typeof detailTabs)[number];
type AppLanguage = "zh" | "en";
type AppTheme = "light" | "dark";
type ThemePreference = AppTheme | null;

const copy = {
  zh: {
    settings: "设置",
    language: "界面语言",
    displayMode: "显示模式",
    light: "浅色",
    dark: "深色",
    githubPending: "GitHub 仓库待添加",
    startSubtitle: "粘贴在线视频链接，或上传本地视频，转写完成后会沉淀到下方历史中。",
    urlPlaceholder: "粘贴 Bilibili / YouTube / 视频直链",
    transcribe: "转写",
    processing: "处理中...",
    uploadVideo: "上传本地视频",
    history: "历史视频",
    searchHistory: "搜索历史视频标题",
    video: "视频",
    createdAt: "创建时间",
    status: "状态",
    noHistoryTitle: "还没有处理过的视频",
    noHistoryBody: "粘贴链接或上传本地视频，完成后会出现在这里。",
    emptyTitle: "处理中任务",
    renameRequired: "标题不能为空",
    renameFailed: "重命名失败",
    save: "保存",
    cancel: "取消",
    editTitle: "编辑标题",
    notes: "笔记",
    transcript: "转录",
    knowledge: "知识点",
    exportTxt: "导出 TXT",
    exportSrt: "导出 SRT",
    exportMd: "导出 MD 笔记",
    saveObsidian: "保存到 Obsidian",
    saving: "保存中...",
    sideBySide: "并列学习",
    noPlayableVideo: "当前任务没有可播放的视频文件",
    noPlayableUrl: "当前任务没有可播放的视频地址",
    transcriptEmpty: "暂无 transcript",
    transcriptNoMatch: "没有匹配的转录文本",
    notesEmpty: "总结生成后会显示在这里",
    knowledgeEmpty: "知识点生成后会显示在这里",
    overview: "概览",
    coreConclusions: "核心结论",
    logicFlow: "逻辑脉络",
    unnamedKnowledge: "知识点",
    none: "暂无内容",
    savedTo: "已保存到"
  },
  en: {
    settings: "Settings",
    language: "Language",
    displayMode: "Appearance",
    light: "Light",
    dark: "Dark",
    githubPending: "GitHub repository pending",
    startSubtitle: "Paste an online video link or upload a local video. Finished notes will appear in history below.",
    urlPlaceholder: "Paste a Bilibili / YouTube / direct video link",
    transcribe: "Transcribe",
    processing: "Processing...",
    uploadVideo: "Upload local video",
    history: "History",
    searchHistory: "Search video titles",
    video: "Video",
    createdAt: "Created",
    status: "Status",
    noHistoryTitle: "No videos yet",
    noHistoryBody: "Paste a link or upload a local video. Finished jobs will appear here.",
    emptyTitle: "Processing job",
    renameRequired: "Title is required",
    renameFailed: "Rename failed",
    save: "Save",
    cancel: "Cancel",
    editTitle: "Edit title",
    notes: "Notes",
    transcript: "Transcript",
    knowledge: "Knowledge",
    exportTxt: "Export TXT",
    exportSrt: "Export SRT",
    exportMd: "Export Markdown",
    saveObsidian: "Save to Obsidian",
    saving: "Saving...",
    sideBySide: "Side by side",
    noPlayableVideo: "No playable video file for this job",
    noPlayableUrl: "No playable video URL for this job",
    transcriptEmpty: "No transcript yet",
    transcriptNoMatch: "No matching transcript lines",
    notesEmpty: "Notes will appear after summarization",
    knowledgeEmpty: "Knowledge points will appear after summarization",
    overview: "Overview",
    coreConclusions: "Core conclusions",
    logicFlow: "Logic flow",
    unnamedKnowledge: "Knowledge point",
    none: "Nothing yet",
    savedTo: "Saved to"
  }
} as const;

type CopyKey = keyof typeof copy.zh;

export default function App() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState(
    () => new URLSearchParams(window.location.search).get("job") ?? ""
  );
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [onlineUrl, setOnlineUrl] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("转录");
  const [embedSeek, setEmbedSeek] = useState<{ seconds: number; nonce: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>(
    () => (window.localStorage.getItem("bilinote-language") === "en" ? "en" : "zh")
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getStoredThemePreference());
  const [systemTheme, setSystemTheme] = useState<AppTheme>(() => getSystemTheme());
  const theme = themePreference ?? systemTheme;
  const settingsCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(query.matches ? "dark" : "light");
    updateSystemTheme();
    query.addEventListener("change", updateSystemTheme);
    return () => query.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (themePreference) {
      window.localStorage.setItem("bilinote-theme", themePreference);
    } else {
      window.localStorage.removeItem("bilinote-theme");
    }
  }, [themePreference]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const t = (key: CopyKey) => copy[language][key];

  function cancelSettingsClose() {
    if (settingsCloseTimerRef.current !== null) {
      window.clearTimeout(settingsCloseTimerRef.current);
      settingsCloseTimerRef.current = null;
    }
  }

  function scheduleSettingsClose() {
    cancelSettingsClose();
    settingsCloseTimerRef.current = window.setTimeout(() => {
      setSettingsOpen(false);
      settingsCloseTimerRef.current = null;
    }, 300);
  }

  useEffect(() => {
    return () => cancelSettingsClose();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bilinote-language", language);
  }, [language]);

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
      setJobQueryParam(payload.jobId);
      void loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOnlineVideoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = onlineUrl.trim();
    if (!url) {
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/jobs/url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url,
          notes: ""
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "创建在线视频任务失败");
      }

      setOnlineUrl("");
      setActiveDetailTab("转录");
      setSelectedJobId(payload.jobId);
      setJobQueryParam(payload.jobId);
      void loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建在线视频任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedListItem = jobs.find((item) => item.id === selectedJobId);
  const activeJob = selectedJob ?? selectedListItem;
  const summary = selectedJob?.result?.summary;
  const transcript = selectedJob?.result?.transcript ?? [];
  const statusLabel = formatStatus(activeJob?.status, language);
  const hasPlayableVideo = Boolean(
    selectedJob?.id &&
      (selectedJob.result?.video.storedPath ||
        selectedJob.result?.video.playbackUrl ||
        selectedJob.result?.video.embedUrl)
  );
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
    setEmbedSeek(null);
    setActiveDetailTab("转录");
    setSelectedJobId(id);
    setJobQueryParam(id);
  }

  function closeJob() {
    setSelectedJobId("");
    setJobQueryParam("");
  }

  function seekTo(seconds: number) {
    const player = videoRef.current;
    if (!Number.isFinite(seconds)) {
      return;
    }
    if (!player) {
      setEmbedSeek((current) => ({
        seconds: Math.max(0, seconds),
        nonce: (current?.nonce ?? 0) + 1
      }));
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
            <div className="topbar-actions">
              <div
                className="settings-menu"
                onMouseEnter={cancelSettingsClose}
                onMouseLeave={scheduleSettingsClose}
              >
                <button
                  aria-label="设置"
                  className="icon-action"
                  onClick={() => {
                    cancelSettingsClose();
                    setSettingsOpen(true);
                  }}
                  onFocus={cancelSettingsClose}
                  onBlur={scheduleSettingsClose}
                  title={t("settings")}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 0 1-4 0V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8a2 2 0 0 1 0-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7A2 2 0 1 1 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2a2 2 0 0 1 4 0V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
                  </svg>
                </button>
                {settingsOpen && (
                  <div
                    className="settings-dropdown"
                    onFocus={cancelSettingsClose}
                    onBlur={scheduleSettingsClose}
                  >
                    <div className="setting-row">
                      <span>{t("language")}</span>
                      <div className="segmented-control">
                        <button
                          className={language === "zh" ? "active" : ""}
                          onClick={() => setLanguage("zh")}
                          type="button"
                        >
                          中
                        </button>
                        <button
                          className={language === "en" ? "active" : ""}
                          onClick={() => setLanguage("en")}
                          type="button"
                        >
                          EN
                        </button>
                      </div>
                    </div>
                    <div className="setting-row">
                      <span>{t("displayMode")}</span>
                      <div className="segmented-control">
                        <button
                          className={theme === "light" ? "active" : ""}
                          onClick={() => setThemePreference("light")}
                          type="button"
                        >
                          {t("light")}
                        </button>
                        <button
                          className={theme === "dark" ? "active" : ""}
                          onClick={() => setThemePreference("dark")}
                          type="button"
                        >
                          {t("dark")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button
                aria-label={t("githubPending")}
                className="icon-action github-action"
                title={t("githubPending")}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 .5A11.5 11.5 0 0 0 8.4 23c.6.1.8-.3.8-.6v-2.1c-3.4.7-4.1-1.5-4.1-1.5-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.6 2.8 3.4 2 .1-.8.4-1.4.8-1.8-2.7-.3-5.5-1.4-5.5-6.1 0-1.4.5-2.5 1.2-3.3-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.4 1.3a11.8 11.8 0 0 1 6.2 0C17.7 4.7 18.7 5 18.7 5c.6 1.7.2 3 .1 3.3.8.9 1.2 2 1.2 3.3 0 4.7-2.8 5.8-5.5 6.1.5.4.9 1.2.9 2.4v2.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5Z" />
                </svg>
              </button>
            </div>
          </header>
        )}

        {error && <div className="notice error">{error}</div>}

        {selectedJobId ? (
          <DetailView
            activeTab={activeDetailTab}
            embedSeek={embedSeek}
            hasPlayableVideo={hasPlayableVideo}
            job={selectedJob}
            onBack={closeJob}
            onChangeTab={setActiveDetailTab}
            onJobUpdate={setSelectedJob}
            onSeek={seekTo}
            statusLabel={statusLabel}
            summary={summary}
            transcript={transcript}
            videoRef={videoRef}
            t={t}
            language={language}
          />
        ) : (
          <HomeView
            jobs={filteredJobs}
            onlineUrl={onlineUrl}
            onChangeOnlineUrl={setOnlineUrl}
            onChangeQuery={setQuery}
            onJobUpdate={setSelectedJob}
            onReloadJobs={loadJobs}
            onOpenJob={openJob}
            onSubmitOnlineVideo={handleOnlineVideoSubmit}
            onUploadVideo={handleVideoUpload}
            query={query}
            submitting={submitting}
            t={t}
            language={language}
          />
        )}
      </section>
    </main>
  );
}

function HomeView({
  jobs,
  onlineUrl,
  onChangeOnlineUrl,
  onChangeQuery,
  onJobUpdate,
  onReloadJobs,
  onOpenJob,
  onSubmitOnlineVideo,
  onUploadVideo,
  query,
  submitting,
  t,
  language
}: {
  jobs: JobListItem[];
  onlineUrl: string;
  onChangeOnlineUrl: (value: string) => void;
  onChangeQuery: (value: string) => void;
  onJobUpdate: (job: JobRecord) => void;
  onReloadJobs: () => Promise<void>;
  onOpenJob: (id: string) => void;
  onSubmitOnlineVideo: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUploadVideo: (file: File | undefined) => Promise<void>;
  query: string;
  submitting: boolean;
  t: (key: CopyKey) => string;
  language: AppLanguage;
}) {
  const [editingJobId, setEditingJobId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

  async function saveTitle(jobId: string) {
    const title = draftTitle.trim();
    if (!title) {
      setRenameError(t("renameRequired"));
      return;
    }

    setRenaming(true);
    setRenameError("");
    try {
      const response = await fetch(`/api/jobs/${jobId}/title`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? t("renameFailed"));
      }

      onJobUpdate(payload);
      await onReloadJobs();
      setEditingJobId("");
      setDraftTitle("");
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : t("renameFailed"));
    } finally {
      setRenaming(false);
    }
  }

  return (
    <section className="home-view">
      <section className="start-panel">
        <div className="start-copy">
          <img alt="BiliNote" className="start-logo" src="/bilinote-logo.png" />
          <p>{t("startSubtitle")}</p>
        </div>
        <form className="url-submit home-url-submit" onSubmit={(event) => void onSubmitOnlineVideo(event)}>
          <input
            disabled={submitting}
            onChange={(event) => onChangeOnlineUrl(event.target.value)}
            placeholder={t("urlPlaceholder")}
            value={onlineUrl}
          />
          <button disabled={submitting || onlineUrl.trim().length === 0} type="submit">
            {submitting ? t("processing") : t("transcribe")}
          </button>
        </form>
        <div className="start-actions">
          <label className={`primary-action upload-action ${submitting ? "busy" : ""}`}>
            <input
              accept=".mp4,.mov,.mkv,.webm,video/*"
              disabled={submitting}
              type="file"
              onChange={(event) => {
                void onUploadVideo(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {t("uploadVideo")}
          </label>
        </div>
      </section>

      <section className="history-section">
        <div className="list-header">
          <h1>{t("history")}</h1>
          <div className="search-box history-search">
            <span>⌕</span>
            <input
              onChange={(event) => onChangeQuery(event.target.value)}
              placeholder={t("searchHistory")}
              value={query}
            />
          </div>
        </div>

        <div className="history-table">
        <div className="table-head">
          <span>{t("video")}</span>
          <span>{t("createdAt")}</span>
          <span>{t("status")}</span>
        </div>
        {renameError && <div className="notice error history-error">{renameError}</div>}
        {jobs.length === 0 ? (
          <div className="empty-state">
            <h2>{t("noHistoryTitle")}</h2>
            <p>{t("noHistoryBody")}</p>
          </div>
        ) : (
          jobs.map((job) => {
            const title = job.result?.video.originalName ?? t("emptyTitle");
            const isEditing = editingJobId === job.id;

            return (
            <div
              className={`history-row ${isEditing ? "editing" : ""}`}
              key={job.id}
              onClick={() => {
                if (!isEditing) {
                  onOpenJob(job.id);
                }
              }}
              role="button"
              tabIndex={isEditing ? -1 : 0}
              onKeyDown={(event) => {
                if (!isEditing && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onOpenJob(job.id);
                }
              }}
            >
              <span className="item-cell">
                <span className="thumbnail">
                  {job.result?.video.storedPath ? (
                    <video muted preload="metadata" src={`/api/jobs/${job.id}/video`} />
                  ) : job.result?.video.sourceUrl ? (
                    <span>URL</span>
                  ) : (
                    <span>{job.progress}%</span>
                  )}
                </span>
                <span className="history-title-wrap">
                  {isEditing ? (
                    <form
                      className="rename-form"
                      onClick={(event) => event.stopPropagation()}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveTitle(job.id);
                      }}
                    >
                      <input
                        autoFocus
                        disabled={renaming}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        value={draftTitle}
                      />
                      <button disabled={renaming} type="submit">
                        {t("save")}
                      </button>
                      <button
                        disabled={renaming}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingJobId("");
                          setDraftTitle("");
                          setRenameError("");
                        }}
                        type="button"
                      >
                        {t("cancel")}
                      </button>
                    </form>
                  ) : (
                    <span className="history-title-line">
                      <span className="history-title-button">
                        <strong>{title}</strong>
                      </span>
                      {job.result && (
                        <button
                          aria-label={t("editTitle")}
                          className="title-edit-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingJobId(job.id);
                            setDraftTitle(title);
                            setRenameError("");
                          }}
                          title={t("editTitle")}
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20">
                            <path d="M4 14.7V17h2.3L15 8.3 12.7 6 4 14.7Z" />
                            <path d="M13.5 5.2 14.8 4a1.4 1.4 0 0 1 2 2l-1.2 1.3-2.1-2.1Z" />
                          </svg>
                        </button>
                      )}
                    </span>
                  )}
                  <small>
                    {formatDuration(job.result?.duration ?? 0)}
                    {job.status !== "done" ? ` · ${formatStatus(job.status, language)} ${job.progress}%` : ""}
                  </small>
                </span>
              </span>
              <span>{formatDate(job.createdAt)}</span>
              <span className="history-status-cell">
                <span>{formatStatus(job.status, language)}{job.status !== "done" ? ` ${job.progress}%` : ""}</span>
              </span>
            </div>
            );
          })
        )}
        </div>
      </section>
    </section>
  );
}

function DetailView({
  activeTab,
  embedSeek,
  hasPlayableVideo,
  job,
  onBack,
  onChangeTab,
  onJobUpdate,
  onSeek,
  statusLabel,
  summary,
  transcript,
  videoRef,
  t,
  language
}: {
  activeTab: DetailTab;
  embedSeek: { seconds: number; nonce: number } | null;
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
  t: (key: CopyKey) => string;
  language: AppLanguage;
}) {
  const title = job?.result?.video.originalName ?? t("emptyTitle");
  const [exportOpen, setExportOpen] = useState(false);
  const [textQuery, setTextQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteMessage, setNoteMessage] = useState("");
  const [videoWidth, setVideoWidth] = useState(57);
  const [draftTranscript, setDraftTranscript] = useState<TranscriptSegment[]>(transcript);
  const detailGridRef = useRef<HTMLDivElement | null>(null);
  const sourceUrl = job?.result?.video.sourceUrl;
  const jobId = job?.id;

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
        throw new Error(payload.error ?? t("renameFailed"));
      }
      onJobUpdate(payload);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotesToObsidian() {
    if (!job?.id) {
      return;
    }

    setSavingNote(true);
    setNoteMessage("");
    try {
      const response = await fetch(`/api/jobs/${job.id}/save-obsidian`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? t("saveObsidian"));
      }
      setExportOpen(false);
      setNoteMessage(`${t("savedTo")} ${payload.path}`);
    } catch (err) {
      setNoteMessage(err instanceof Error ? err.message : t("saveObsidian"));
    } finally {
      setSavingNote(false);
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
                <a href={`/api/jobs/${job.id}/transcript.txt`}>{t("exportTxt")}</a>
                <a href={`/api/jobs/${job.id}/transcript.srt`}>{t("exportSrt")}</a>
                <a href={`/api/jobs/${job.id}/notes.md`}>{t("exportMd")}</a>
                <button disabled={savingNote} onClick={() => void saveNotesToObsidian()} type="button">
                  {savingNote ? t("saving") : t("saveObsidian")}
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      {noteMessage && <div className="notice inline-notice">{noteMessage}</div>}

      <div
        className="detail-grid"
        ref={detailGridRef}
        style={{
          "--video-width": `${videoWidth}%`
        } as CSSProperties}
      >
        <section className="video-column">
          {hasPlayableVideo ? (
            <OnlinePlayer embedSeek={embedSeek} job={job} videoRef={videoRef} t={t} />
          ) : (
            <div className="video-placeholder">
              {job?.status === "done" ? t("noPlayableVideo") : `${statusLabel} ${job?.progress ?? 0}%`}
            </div>
          )}
          <div className="video-meta-panel">
            <span>{formatDuration(lastTranscriptTime(transcript))}</span>
            <span>{transcript.length} 段转录</span>
            <span>{statusLabel}</span>
            {jobId && sourceUrl && (
              <button onClick={() => openSideBySide(jobId, sourceUrl)} type="button">
                {t("sideBySide")}
              </button>
            )}
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
                  {tabLabel(tab, language)}
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
                      {t("cancel")}
                    </button>
                    <button
                      className="edit-button"
                      disabled={saving}
                      onClick={() => void saveTranscript()}
                      type="button"
                    >
                      {saving ? t("saving") : t("save")}
                    </button>
                  </div>
                ) : (
                  <button
                    className="edit-button"
                    disabled={transcript.length === 0}
                    onClick={() => setEditing(true)}
                    type="button"
                  >
                    {t("editTitle")}
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
              t={t}
            />
          )}
          {activeTab === "笔记" && <NotesPane summary={summary} t={t} />}
          {activeTab === "知识点" && (
            <KnowledgePane onSeek={onSeek} summary={summary} transcript={transcript} t={t} />
          )}
        </aside>
      </div>
    </section>
  );
}

function OnlinePlayer({
  embedSeek,
  job,
  videoRef,
  t
}: {
  embedSeek: { seconds: number; nonce: number } | null;
  job: JobRecord | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  t: (key: CopyKey) => string;
}) {
  const video = job?.result?.video;
  const localVideoUrl = job?.id && video?.storedPath ? `/api/jobs/${job.id}/video` : undefined;
  const directVideoUrl = localVideoUrl ?? video?.playbackUrl;

  if (directVideoUrl) {
    return <video controls preload="metadata" ref={videoRef} src={directVideoUrl} />;
  }

  if (video?.embedUrl) {
    return (
      <iframe
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="video-embed"
        key={`${job?.id ?? "online"}-${embedSeek?.nonce ?? 0}`}
        src={withStartTime(video.embedUrl, embedSeek?.seconds)}
        title={video.originalName}
      />
    );
  }

  return <div className="video-placeholder">{t("noPlayableUrl")}</div>;
}

function TranscriptPane({
  editing,
  onChangeDraft,
  onSeek,
  query,
  transcript,
  t
}: {
  editing: boolean;
  onChangeDraft: (segments: TranscriptSegment[]) => void;
  onSeek: (seconds: number) => void;
  query: string;
  transcript: TranscriptSegment[];
  t: (key: CopyKey) => string;
}) {
  if (transcript.length === 0) {
    return <div className="empty-state compact-empty">{t("transcriptEmpty")}</div>;
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
        <div className="empty-state compact-empty">{t("transcriptNoMatch")}</div>
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

function NotesPane({ summary, t }: { summary?: KnowledgeSummary; t: (key: CopyKey) => string }) {
  if (!summary) {
    return <div className="empty-state compact-empty">{t("notesEmpty")}</div>;
  }

  return (
    <div className="notes-stream">
      <article>
        <h2>{t("overview")}</h2>
        <p>{summary.overview}</p>
      </article>
      <article>
        <h2>{t("coreConclusions")}</h2>
        <List items={summary.coreConclusions} />
      </article>
      <article>
        <h2>{t("logicFlow")}</h2>
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
  transcript,
  t
}: {
  onSeek: (seconds: number) => void;
  summary?: KnowledgeSummary;
  transcript: TranscriptSegment[];
  t: (key: CopyKey) => string;
}) {
  if (!summary) {
    return <div className="empty-state compact-empty">{t("knowledgeEmpty")}</div>;
  }

  return (
    <div className="notes-stream">
      {summary.knowledgeTree.map((item, index) => (
        <article key={`${item.topic}-${index}`}>
          <h2>{item.topic || `${t("unnamedKnowledge")} ${index + 1}`}</h2>
          <TimedList items={item.points} onSeek={onSeek} transcript={transcript} />
        </article>
      ))}
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

function setJobQueryParam(jobId: string) {
  const url = new URL(window.location.href);
  if (jobId) {
    url.searchParams.set("job", jobId);
  } else {
    url.searchParams.delete("job");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function getStoredThemePreference(): ThemePreference {
  const value = window.localStorage.getItem("bilinote-theme");
  return value === "light" || value === "dark" ? value : null;
}

function getSystemTheme(): AppTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function openSideBySide(jobId: string, sourceUrl: string) {
  const screenWidth = window.screen.availWidth || 1440;
  const screenHeight = window.screen.availHeight || 900;
  const halfWidth = Math.max(720, Math.floor(screenWidth / 2));
  const appUrl = new URL(window.location.href);
  appUrl.searchParams.set("job", jobId);

  window.open(
    sourceUrl,
    "bilinote_source",
    `popup=yes,left=0,top=0,width=${halfWidth},height=${screenHeight}`
  );
  window.open(
    appUrl.toString(),
    "bilinote_notes",
    `popup=yes,left=${halfWidth},top=0,width=${screenWidth - halfWidth},height=${screenHeight}`
  );
}

function withStartTime(url: string, seconds?: number): string {
  if (!Number.isFinite(seconds)) {
    return url;
  }
  const safeSeconds = Math.max(0, Math.floor(seconds ?? 0));
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      parsed.searchParams.set("start", String(safeSeconds));
      parsed.searchParams.set("autoplay", "1");
      return parsed.toString();
    }
    if (parsed.hostname.includes("bilibili.com")) {
      parsed.searchParams.set("t", String(safeSeconds));
      parsed.searchParams.set("autoplay", "1");
      return parsed.toString();
    }
  } catch {
    // Leave the embed URL untouched if parsing fails.
  }
  return url;
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

function tabLabel(tab: DetailTab, language: AppLanguage): string {
  if (language === "en") {
    switch (tab) {
      case "笔记":
        return "Notes";
      case "转录":
        return "Transcript";
      case "知识点":
        return "Knowledge";
    }
  }
  return tab;
}

function formatStatus(status?: JobStatus, language: AppLanguage = "zh") {
  if (language === "en") {
    switch (status) {
      case "queued":
        return "Queued";
      case "extracting_audio":
        return "Extracting audio";
      case "transcribing":
        return "Transcribing";
      case "summarizing":
        return "Summarizing";
      case "done":
        return "Done";
      case "failed":
        return "Failed";
      default:
        return "Not started";
    }
  }

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
