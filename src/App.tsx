import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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

interface ProcessingInfo {
  transcriptSource: "manual" | "subtitle" | "whisper" | "cache";
  label: string;
  detail?: string;
  whisperModel?: string;
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
      subtitlePath?: string;
      audioPath?: string;
    };
    transcript: TranscriptSegment[];
    originalTranscript?: TranscriptSegment[];
    summary?: KnowledgeSummary;
    processing?: ProcessingInfo;
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
      subtitlePath?: string;
      audioPath?: string;
    };
    transcriptCount: number;
    duration: number;
    processing?: ProcessingInfo;
  };
}

interface WhisperModel {
  id: string;
  filename: string;
  label: string;
  size: string;
  hint: string;
  url: string;
  modelPath: string;
  installed: boolean;
}

interface ApiSettings {
  provider: "openai" | "deepseek" | "compatible";
  apiKey: string;
  baseURL: string;
  model: string;
}

const detailTabs = ["笔记", "转录", "知识点"] as const;
type DetailTab = (typeof detailTabs)[number];
type AppLanguage = "zh" | "en";
type AppTheme = "light" | "dark";
type ThemePreference = AppTheme | null;
type LocalTranscriptMode = "auto" | "whisper" | "subtitle";

interface YouTubePlayer {
  destroy: () => void;
  getCurrentTime: () => number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLIFrameElement,
        options?: {
          events?: {
            onReady?: () => void;
            onStateChange?: () => void;
          };
        }
      ) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const copy = {
  zh: {
    settings: "设置",
    language: "界面语言",
    displayMode: "显示模式",
    speechModel: "语音转文字模型",
    localTranscriptMode: "字幕选项",
    localAuto: "自动字幕优先",
    localWhisper: "强制 Whisper",
    localSubtitle: "使用字幕文件",
    delete: "删除",
    deleteVideo: "删除视频",
    deleteConfirmTitle: "删除这条历史视频？",
    deleteConfirmBody: "这会终止正在进行的任务，并删除已生成的转录、字幕、音频、缓存和笔记结果。",
    installModelTitle: "安装语音转文字模型？",
    installModelBody: "安装会下载模型文件到本地数据目录，下载期间请保持服务运行。",
    confirm: "确认",
    install: "安装",
    installing: "安装中...",
    notInstalled: "未安装",
    transcriptSource: "处理方式",
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
    edit: "编辑",
    editTitle: "编辑标题",
    notes: "笔记",
    transcript: "转录",
    knowledge: "知识点",
    exportTxt: "导出 TXT",
    exportSrt: "导出 SRT",
    exportMd: "导出 MD 笔记",
    saveObsidian: "保存到 Obsidian",
    saving: "保存中...",
    sideBySide: "独立视频窗口",
    apiSettings: "API 配置",
    apiProvider: "服务商",
    apiKey: "API Key",
    apiBaseUrl: "Base URL",
    apiModel: "模型名",
    apiKeyPlaceholder: "留空则使用后端 .env",
    apiBaseUrlPlaceholder: "例如 https://api.openai.com/v1",
    apiModelPlaceholder: "例如 gpt-4.1-mini / deepseek-v4-flash",
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
    speechModel: "Speech model",
    localTranscriptMode: "Subtitle options",
    localAuto: "Subtitles first",
    localWhisper: "Force Whisper",
    localSubtitle: "Use subtitle file",
    delete: "Delete",
    deleteVideo: "Delete video",
    deleteConfirmTitle: "Delete this video?",
    deleteConfirmBody: "This will stop any running job and remove generated transcripts, subtitles, audio, cache, and notes.",
    installModelTitle: "Install speech model?",
    installModelBody: "The model file will be downloaded into the local app data directory. Keep the service running while it installs.",
    confirm: "Confirm",
    install: "Install",
    installing: "Installing...",
    notInstalled: "Not installed",
    transcriptSource: "Processing",
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
    edit: "Edit",
    editTitle: "Edit title",
    notes: "Notes",
    transcript: "Transcript",
    knowledge: "Knowledge",
    exportTxt: "Export TXT",
    exportSrt: "Export SRT",
    exportMd: "Export Markdown",
    saveObsidian: "Save to Obsidian",
    saving: "Saving...",
    sideBySide: "Standalone video window",
    apiSettings: "API settings",
    apiProvider: "Provider",
    apiKey: "API Key",
    apiBaseUrl: "Base URL",
    apiModel: "Model",
    apiKeyPlaceholder: "Blank uses backend .env",
    apiBaseUrlPlaceholder: "e.g. https://api.openai.com/v1",
    apiModelPlaceholder: "e.g. gpt-4.1-mini / deepseek-v4-flash",
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
const historyPageSize = 10;

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
  const [localTranscriptMode, setLocalTranscriptMode] = useState<LocalTranscriptMode>("auto");
  const [localSubtitleFile, setLocalSubtitleFile] = useState<File | null>(null);
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const [installCandidate, setInstallCandidate] = useState<WhisperModel | null>(null);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => loadStoredApiSettings());
  const [playbackTime, setPlaybackTime] = useState(0);
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("转录");
  const [embedSeek, setEmbedSeek] = useState<{ seconds: number; nonce: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [whisperModels, setWhisperModels] = useState<WhisperModel[]>([]);
  const [selectedWhisperModelPath, setSelectedWhisperModelPath] = useState(
    () => window.localStorage.getItem("bilinote-whisper-model") ?? ""
  );
  const [installingModelId, setInstallingModelId] = useState("");
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
    }, 100);
  }

  useEffect(() => {
    return () => cancelSettingsClose();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bilinote-language", language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem("bilinote-whisper-model", selectedWhisperModelPath);
  }, [selectedWhisperModelPath]);

  useEffect(() => {
    window.localStorage.setItem("bilinote-api-settings", JSON.stringify(apiSettings));
  }, [apiSettings]);

  useEffect(() => {
    void loadJobs();
    void loadWhisperModels();
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
    try {
      const response = await fetch("/api/jobs");
      const payload = await response.json();
      if (response.ok) {
        setJobs(payload);
      }
    } catch {
      // The dev server can briefly restart while polling; keep the last known list.
    }
  }

  async function loadWhisperModels() {
    try {
      const response = await fetch("/api/whisper-models");
      const payload = await response.json();
      if (response.ok) {
        setWhisperModels(payload.models ?? []);
        if (!selectedWhisperModelPath) {
          const defaultModel = (payload.models ?? []).find((model: WhisperModel) => model.installed);
          if (defaultModel) {
            setSelectedWhisperModelPath(defaultModel.modelPath);
          }
        }
      }
    } catch {
      // Model discovery is optional; transcription can still use .env defaults.
    }
  }

  async function installWhisperModel(modelId: string) {
    setInstallingModelId(modelId);
    setError("");
    try {
      const response = await fetch("/api/whisper-models/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: modelId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "模型安装失败");
      }
      setWhisperModels(payload.models ?? []);
      if (payload.modelPath) {
        setSelectedWhisperModelPath(payload.modelPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型安装失败");
    } finally {
      setInstallingModelId("");
    }
  }

  function requestWhisperModel(modelId: string) {
    const model = whisperModels.find((item) => item.id === modelId);
    if (!model) {
      return;
    }
    if (!model.installed) {
      setInstallCandidate(model);
      return;
    }
    setSelectedWhisperModelPath(model.modelPath);
  }

  async function confirmInstallWhisperModel() {
    if (!installCandidate) {
      return;
    }
    await installWhisperModel(installCandidate.id);
    setInstallCandidate(null);
  }

  async function deleteJob(jobId: string) {
    const response = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "删除任务失败");
    }
    if (selectedJobId === jobId) {
      closeJob();
    }
    await loadJobs();
  }

  async function handleVideoUpload(file: File | undefined, subtitleFile?: File | null) {
    if (!file) {
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("video", file);
      if (subtitleFile) {
        formData.append("subtitle", subtitleFile);
      }
      formData.append("manualTranscript", "");
      formData.append("localTranscriptMode", localTranscriptMode);
      formData.append("whisperModelPath", selectedWhisperModelPath);
      formData.append("apiConfig", JSON.stringify(buildApiConfigPayload(apiSettings)));
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
      setLocalSubtitleFile(null);
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
          whisperModelPath: selectedWhisperModelPath,
          apiConfig: buildApiConfigPayload(apiSettings),
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
    setPlaybackTime(0);
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
      setPlaybackTime(Math.max(0, seconds));
      setEmbedSeek((current) => ({
        seconds: Math.max(0, seconds),
        nonce: (current?.nonce ?? 0) + 1
      }));
      return;
    }
    player.currentTime = Math.max(0, seconds);
    setPlaybackTime(Math.max(0, seconds));
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
                    <div className="setting-row compact-setting-row">
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
                    <div className="setting-row compact-setting-row">
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
                    <div className="setting-row compact-setting-row model-setting-row">
                      <span className="setting-label-with-info">
                        {t("speechModel")}
                        <button
                          aria-label="模型说明"
                          className="model-info-button"
                          onBlur={() => setModelInfoOpen(false)}
                          onClick={() => setModelInfoOpen((value) => !value)}
                          onFocus={() => setModelInfoOpen(true)}
                          type="button"
                        >
                          <InfoIcon />
                        </button>
                      </span>
                      <div className="model-select-wrap">
                        <select
                          disabled={installingModelId.length > 0}
                          onChange={(event) => requestWhisperModel(event.target.value)}
                          value={
                            whisperModels.find((model) => model.modelPath === selectedWhisperModelPath)?.id ?? ""
                          }
                        >
                          <option value="" disabled>
                            {t("speechModel")}
                          </option>
                          {whisperModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label} · {model.size} · {model.installed ? modelInstalledLabel(language) : t("notInstalled")}
                            </option>
                          ))}
                        </select>
                        {modelInfoOpen && (
                          <div className="model-info-popover">
                            {whisperModels.map((model) => (
                              <p key={model.id}>
                                <strong>{model.label}</strong>
                                <span>{model.size} · {model.hint}</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="settings-divider" />
                    <div className="api-settings-block">
                      <strong>{t("apiSettings")}</strong>
                      <label>
                        <span>{t("apiProvider")}</span>
                        <select
                          value={apiSettings.provider}
                          onChange={(event) =>
                            setApiSettings((current) => ({
                              ...current,
                              provider: event.target.value as ApiSettings["provider"]
                            }))
                          }
                        >
                          <option value="openai">OpenAI</option>
                          <option value="deepseek">DeepSeek</option>
                          <option value="compatible">兼容接口</option>
                        </select>
                      </label>
                      <label>
                        <span>{t("apiKey")}</span>
                        <input
                          autoComplete="off"
                          onChange={(event) =>
                            setApiSettings((current) => ({ ...current, apiKey: event.target.value }))
                          }
                          placeholder={t("apiKeyPlaceholder")}
                          type="password"
                          value={apiSettings.apiKey}
                        />
                      </label>
                      <label>
                        <span>{t("apiBaseUrl")}</span>
                        <input
                          onChange={(event) =>
                            setApiSettings((current) => ({ ...current, baseURL: event.target.value }))
                          }
                          placeholder={t("apiBaseUrlPlaceholder")}
                          value={apiSettings.baseURL}
                        />
                      </label>
                      <label>
                        <span>{t("apiModel")}</span>
                        <input
                          onChange={(event) =>
                            setApiSettings((current) => ({ ...current, model: event.target.value }))
                          }
                          placeholder={t("apiModelPlaceholder")}
                          value={apiSettings.model}
                        />
                      </label>
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
            playbackTime={playbackTime}
            onPlaybackTimeChange={setPlaybackTime}
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
            onDeleteJob={deleteJob}
            onSubmitOnlineVideo={handleOnlineVideoSubmit}
            onUploadVideo={handleVideoUpload}
            localTranscriptMode={localTranscriptMode}
            localSubtitleFile={localSubtitleFile}
            onChangeLocalTranscriptMode={setLocalTranscriptMode}
            onChangeLocalSubtitleFile={setLocalSubtitleFile}
            query={query}
            submitting={submitting}
            t={t}
            language={language}
          />
        )}
        {installCandidate && (
          <ConfirmDialog
            body={`${t("installModelBody")} ${installCandidate.label} (${installCandidate.size})`}
            cancelLabel={t("cancel")}
            confirmLabel={installingModelId === installCandidate.id ? t("installing") : t("install")}
            disabled={installingModelId.length > 0}
            onCancel={() => setInstallCandidate(null)}
            onConfirm={() => void confirmInstallWhisperModel()}
            title={t("installModelTitle")}
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
  onDeleteJob,
  onSubmitOnlineVideo,
  onUploadVideo,
  localTranscriptMode,
  localSubtitleFile,
  onChangeLocalTranscriptMode,
  onChangeLocalSubtitleFile,
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
  onDeleteJob: (id: string) => Promise<void>;
  onSubmitOnlineVideo: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUploadVideo: (file: File | undefined, subtitleFile?: File | null) => Promise<void>;
  localTranscriptMode: LocalTranscriptMode;
  localSubtitleFile: File | null;
  onChangeLocalTranscriptMode: (value: LocalTranscriptMode) => void;
  onChangeLocalSubtitleFile: (file: File | null) => void;
  query: string;
  submitting: boolean;
  t: (key: CopyKey) => string;
  language: AppLanguage;
}) {
  const [editingJobId, setEditingJobId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<JobListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subtitleOptionsOpen, setSubtitleOptionsOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const totalPages = Math.max(1, Math.ceil(jobs.length / historyPageSize));
  const visibleJobs = jobs.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);

  useEffect(() => {
    setHistoryPage(1);
  }, [query]);

  useEffect(() => {
    setHistoryPage((page) => Math.min(Math.max(1, page), totalPages));
  }, [totalPages]);

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

  async function confirmDeleteJob() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setRenameError("");
    try {
      await onDeleteJob(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : t("deleteVideo"));
    } finally {
      setDeleting(false);
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
                void onUploadVideo(event.target.files?.[0], localSubtitleFile);
                event.currentTarget.value = "";
              }}
            />
            {t("uploadVideo")}
          </label>
          <button
            aria-label={t("localTranscriptMode")}
            className={`caption-toggle ${subtitleOptionsOpen ? "active" : ""}`}
            onClick={() => setSubtitleOptionsOpen((value) => !value)}
            title={t("localTranscriptMode")}
            type="button"
          >
            <ClosedCaptionIcon />
          </button>
        </div>
        {subtitleOptionsOpen && (
          <div className="local-mode-panel">
            <input
              accept=".srt,.vtt,text/vtt,application/x-subrip"
              disabled={submitting}
              ref={subtitleInputRef}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                onChangeLocalSubtitleFile(file);
                if (file) {
                  onChangeLocalTranscriptMode("subtitle");
                }
              }}
            />
            <div className="segmented-control local-mode-control">
              <button
                className={localTranscriptMode === "auto" ? "active" : ""}
                onClick={() => onChangeLocalTranscriptMode("auto")}
                type="button"
              >
                {t("localAuto")}
              </button>
              <button
                className={localTranscriptMode === "whisper" ? "active" : ""}
                onClick={() => onChangeLocalTranscriptMode("whisper")}
                type="button"
              >
                {t("localWhisper")}
              </button>
              <button
                className={localTranscriptMode === "subtitle" ? "active" : ""}
                onClick={() => {
                  onChangeLocalTranscriptMode("subtitle");
                  subtitleInputRef.current?.click();
                }}
                type="button"
              >
                {localSubtitleFile?.name ?? t("localSubtitle")}
              </button>
            </div>
          </div>
        )}
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
          <span>{t("speechModel")}</span>
          <span>{t("createdAt")}</span>
          <span>{t("status")}</span>
          <span aria-label={t("delete")} />
        </div>
        {renameError && <div className="notice error history-error">{renameError}</div>}
        {jobs.length === 0 ? (
          <div className="empty-state">
            <h2>{t("noHistoryTitle")}</h2>
            <p>{t("noHistoryBody")}</p>
          </div>
        ) : (
          visibleJobs.map((job) => {
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
              <span className="history-model-cell">
                {job.result?.processing ? (
                  <span className={`source-badge ${job.result.processing.transcriptSource}`}>
                    {processingLabel(job.result.processing, language)}
                  </span>
                ) : (
                  <span className="muted">--</span>
                )}
              </span>
              <span>{formatDate(job.createdAt)}</span>
              <span className="history-status-cell">
                <span>{formatStatus(job.status, language)}{job.status !== "done" ? ` ${job.progress}%` : ""}</span>
              </span>
              <span className="history-actions-cell">
                <button
                  aria-label={t("deleteVideo")}
                  className="delete-job-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget(job);
                  }}
                  title={t("deleteVideo")}
                  type="button"
                >
                  <TrashIcon />
                </button>
              </span>
            </div>
            );
          })
        )}
        </div>
        {jobs.length > historyPageSize && (
          <HistoryPagination
            currentPage={historyPage}
            language={language}
            onChangePage={setHistoryPage}
            pageSize={historyPageSize}
            totalItems={jobs.length}
            totalPages={totalPages}
          />
        )}
      </section>
      {deleteTarget && (
        <ConfirmDialog
          body={t("deleteConfirmBody")}
          cancelLabel={t("cancel")}
          confirmLabel={deleting ? t("processing") : t("delete")}
          disabled={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDeleteJob()}
          title={t("deleteConfirmTitle")}
        />
      )}
    </section>
  );
}

function HistoryPagination({
  currentPage,
  language,
  onChangePage,
  pageSize,
  totalItems,
  totalPages
}: {
  currentPage: number;
  language: AppLanguage;
  onChangePage: (page: number) => void;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}) {
  const pages = buildPageNumbers(currentPage, totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const previousLabel = language === "zh" ? "前页" : "Prev";
  const nextLabel = language === "zh" ? "后页" : "Next";
  const totalLabel = language === "zh" ? `共${totalItems}条` : `${totalItems} total`;
  const rangeLabel = language === "zh" ? `${start}-${end}` : `${start}-${end}`;

  return (
    <nav className="history-pagination" aria-label={language === "zh" ? "历史分页" : "History pagination"}>
      <button
        className="pagination-step"
        disabled={currentPage <= 1}
        onClick={() => onChangePage(currentPage - 1)}
        type="button"
      >
        &lt;{previousLabel}
      </button>
      <span className="pagination-pages">
        {pages.map((page, index) =>
          page === "ellipsis" ? (
            <span className="pagination-ellipsis" key={`ellipsis-${index}`}>
              ...
            </span>
          ) : (
            <button
              aria-current={page === currentPage ? "page" : undefined}
              className={page === currentPage ? "active" : ""}
              key={page}
              onClick={() => onChangePage(page)}
              type="button"
            >
              {page}
            </button>
          )
        )}
      </span>
      <button
        className="pagination-step"
        disabled={currentPage >= totalPages}
        onClick={() => onChangePage(currentPage + 1)}
        type="button"
      >
        {nextLabel}&gt;
      </button>
      <span className="pagination-count">
        {rangeLabel} / {totalLabel}
      </span>
    </nav>
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
  playbackTime,
  onPlaybackTimeChange,
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
  playbackTime: number;
  onPlaybackTimeChange: (seconds: number) => void;
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
  const exportCloseTimerRef = useRef<number | null>(null);
  const sourceUrl = job?.result?.video.sourceUrl;
  const jobId = job?.id;
  const currentSegment = findCurrentSegment(transcript, playbackTime);

  function cancelExportClose() {
    if (exportCloseTimerRef.current !== null) {
      window.clearTimeout(exportCloseTimerRef.current);
      exportCloseTimerRef.current = null;
    }
  }

  function scheduleExportClose() {
    cancelExportClose();
    exportCloseTimerRef.current = window.setTimeout(() => {
      setExportOpen(false);
      exportCloseTimerRef.current = null;
    }, 100);
  }

  useEffect(() => {
    return () => cancelExportClose();
  }, []);

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
            {formatDate(job?.createdAt)} · {formatDuration(lastTranscriptTime(transcript))}
          </p>
        </div>
        {job?.result && (
          <div
            className="export-menu"
            onMouseEnter={cancelExportClose}
            onMouseLeave={scheduleExportClose}
          >
            <button
              aria-label="导出"
              onBlur={scheduleExportClose}
              onClick={() => {
                cancelExportClose();
                setExportOpen(true);
              }}
              onFocus={cancelExportClose}
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
            <OnlinePlayer
              embedSeek={embedSeek}
              job={job}
              onTimeUpdate={onPlaybackTimeChange}
              videoRef={videoRef}
              t={t}
            />
          ) : (
            <div className="video-placeholder">
              {job?.status === "done" ? t("noPlayableVideo") : `${statusLabel} ${job?.progress ?? 0}%`}
            </div>
          )}
          <div className="video-meta-panel">
            <span>{formatDuration(lastTranscriptTime(transcript))}</span>
            <span>{transcript.length} 段转录</span>
            <span className={`source-badge ${job?.result?.processing?.transcriptSource ?? "unknown"}`}>
              {job?.result?.processing
                ? processingLabel(job.result.processing, language)
                : language === "en"
                  ? "Unmarked"
                  : "未标记"}
            </span>
            {jobId && sourceUrl && (
              <button onClick={() => openSideBySide(jobId, sourceUrl)} type="button">
                {t("sideBySide")}
              </button>
            )}
          </div>
          <CurrentCaptionPanel segment={currentSegment} />
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
                    title={t("edit")}
                  >
                    <SquarePenIcon />
                    <span>{t("edit")}</span>
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
              activeSegment={currentSegment}
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
  onTimeUpdate,
  videoRef,
  t
}: {
  embedSeek: { seconds: number; nonce: number } | null;
  job: JobRecord | null;
  onTimeUpdate: (seconds: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  t: (key: CopyKey) => string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const video = job?.result?.video;
  const localVideoUrl = job?.id && video?.storedPath ? `/api/jobs/${job.id}/video` : undefined;
  const directVideoUrl = localVideoUrl ?? video?.playbackUrl;
  const embedUrl = video?.embedUrl ? withStartTime(video.embedUrl, embedSeek?.seconds) : undefined;

  useEffect(() => {
    if (!embedUrl?.includes("youtube.com")) {
      return;
    }

    let disposed = false;
    let timer: number | undefined;
    let fallbackTimer: number | undefined;

    function readCurrentTime() {
      try {
        const currentTime = youtubePlayerRef.current?.getCurrentTime();
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
          onTimeUpdate(currentTime);
        }
      } catch {
        // The iframe can briefly be unavailable during reloads/seeks.
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      const data = typeof event.data === "string" ? safeParseJson(event.data) : event.data;
      const currentTime = data?.info?.currentTime;
      if (data?.event === "infoDelivery" && typeof currentTime === "number") {
        onTimeUpdate(currentTime);
      }
    }

    void loadYouTubeIframeApi().then(() => {
      if (disposed || !iframeRef.current || !window.YT?.Player) {
        return;
      }
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: () => {
            readCurrentTime();
            timer = window.setInterval(readCurrentTime, 500);
          },
          onStateChange: readCurrentTime
        }
      });
    });

    fallbackTimer = window.setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "getCurrentTime", args: [] }),
        "*"
      );
    }, 600);

    window.addEventListener("message", handleMessage);
    return () => {
      disposed = true;
      if (timer) {
        window.clearInterval(timer);
      }
      if (fallbackTimer) {
        window.clearInterval(fallbackTimer);
      }
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
      window.removeEventListener("message", handleMessage);
    };
  }, [embedUrl, onTimeUpdate]);

  if (directVideoUrl) {
    return (
      <video
        controls
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        preload="metadata"
        ref={videoRef}
        src={directVideoUrl}
      />
    );
  }

  if (embedUrl) {
    return (
      <iframe
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="video-embed"
        key={`${job?.id ?? "online"}-${embedSeek?.nonce ?? 0}-${embedUrl}`}
        ref={iframeRef}
        src={embedUrl}
        title={video?.originalName ?? "online video"}
      />
    );
  }

  return <div className="video-placeholder">{t("noPlayableUrl")}</div>;
}

function CurrentCaptionPanel({ segment }: { segment?: TranscriptSegment }) {
  return (
    <div className="current-caption-panel">
      <p>{segment ? formatTranscriptDisplayText(segment.text) : ""}</p>
    </div>
  );
}

function ConfirmDialog({
  body,
  cancelLabel,
  confirmLabel,
  disabled,
  onCancel,
  onConfirm,
  title
}: {
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="confirm-dialog" role="dialog">
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button className="ghost-button" disabled={disabled} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className="danger-button" disabled={disabled} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ClosedCaptionIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="M10 10.5a2.5 2.5 0 1 0 0 3" />
      <path d="M17 10.5a2.5 2.5 0 1 0 0 3" />
    </svg>
  );
}

function SquarePenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}

function TranscriptPane({
  editing,
  onChangeDraft,
  onSeek,
  query,
  activeSegment,
  transcript,
  t
}: {
  editing: boolean;
  onChangeDraft: (segments: TranscriptSegment[]) => void;
  onSeek: (seconds: number) => void;
  query: string;
  activeSegment?: TranscriptSegment;
  transcript: TranscriptSegment[];
  t: (key: CopyKey) => string;
}) {
  const activeLineRef = useRef<HTMLElement | null>(null);
  const keyword = query.trim();
  const activeKey = activeSegment ? segmentKey(activeSegment) : "";

  useEffect(() => {
    if (editing || keyword || !activeKey) {
      return;
    }
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeKey, editing, keyword]);

  if (transcript.length === 0) {
    return <div className="empty-state compact-empty">{t("transcriptEmpty")}</div>;
  }

  const normalizedKeyword = keyword.toLowerCase();
  const visibleTranscript = normalizedKeyword
    ? transcript.filter(
        (item) => {
          const displayText = formatTranscriptDisplayText(item.text).toLowerCase();
          return (
            displayText.includes(normalizedKeyword) ||
            item.timestamp.toLowerCase().includes(normalizedKeyword)
          );
        }
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
          const isActive = activeKey === segmentKey(item);

          return editing ? (
            <div
              className={`minute-line editing-line ${isActive ? "active-line" : ""}`}
              key={`${item.timestamp}-${item.start}`}
              ref={isActive ? (node) => { activeLineRef.current = node; } : undefined}
            >
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
              className={`minute-line ${isActive ? "active-line" : ""}`}
              key={`${item.timestamp}-${item.start}`}
              onClick={() => onSeek(item.start)}
              ref={isActive ? (node) => { activeLineRef.current = node; } : undefined}
              type="button"
            >
              <time>{item.timestamp}</time>
              <span className="line-content">
                <span className="line-text">
                  {highlightQuery(formatTranscriptDisplayText(item.text), keyword)}
                </span>
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

function loadStoredApiSettings(): ApiSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("bilinote-api-settings") ?? "{}") as Partial<ApiSettings>;
    return {
      provider:
        parsed.provider === "deepseek" || parsed.provider === "compatible" || parsed.provider === "openai"
          ? parsed.provider
          : "openai",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      baseURL: typeof parsed.baseURL === "string" ? parsed.baseURL : "",
      model: typeof parsed.model === "string" ? parsed.model : ""
    };
  } catch {
    return { provider: "openai", apiKey: "", baseURL: "", model: "" };
  }
}

function buildApiConfigPayload(settings: ApiSettings) {
  return {
    provider: settings.provider,
    apiKey: settings.apiKey.trim(),
    baseURL: settings.baseURL.trim(),
    model: settings.model.trim()
  };
}

function modelInstalledLabel(language: AppLanguage) {
  return language === "en" ? "Installed" : "已安装";
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
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      parsed.searchParams.set("enablejsapi", "1");
      parsed.searchParams.set("origin", window.location.origin);
      if (Number.isFinite(seconds)) {
        parsed.searchParams.set("start", String(Math.max(0, Math.floor(seconds ?? 0))));
        parsed.searchParams.set("autoplay", "1");
      }
      return parsed.toString();
    }
    if (parsed.hostname.includes("bilibili.com")) {
      if (Number.isFinite(seconds)) {
        parsed.searchParams.set("t", String(Math.max(0, Math.floor(seconds ?? 0))));
        parsed.searchParams.set("autoplay", "1");
      }
      return parsed.toString();
    }
  } catch {
    // Leave the embed URL untouched if parsing fails.
  }
  return url;
}

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

let youtubeApiPromise: Promise<void> | undefined;

function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) {
    return Promise.resolve();
  }
  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (existingScript) {
      existingScript.addEventListener("error", () => reject(new Error("YouTube API 加载失败")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube API 加载失败"));
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
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

function findCurrentSegment(transcript: TranscriptSegment[], seconds: number): TranscriptSegment | undefined {
  if (transcript.length === 0 || !Number.isFinite(seconds)) {
    return undefined;
  }
  return transcript.find((segment, index) => {
    const next = transcript[index + 1];
    const end = segment.end ?? next?.start ?? segment.start + 4;
    return seconds >= segment.start && seconds < end;
  });
}

function segmentKey(segment: TranscriptSegment): string {
  return `${segment.timestamp}-${segment.start}`;
}

function highlightQuery(text: string, query: string) {
  const keyword = query.trim();
  if (!keyword) {
    return text;
  }

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerKeyword);

  while (index >= 0) {
    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }
    const match = text.slice(index, index + keyword.length);
    parts.push(
      <mark className="search-highlight" key={`${index}-${match}`}>
        {match}
      </mark>
    );
    cursor = index + keyword.length;
    index = lowerText.indexOf(lowerKeyword, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

function formatTranscriptDisplayText(text: string): string {
  return text
    .replace(/([A-Za-z0-9][.!?])(?=[A-Z])/g, "$1 ")
    .replace(/([.!?])(?=(?:I|You|He|She|It|We|They|The|This|That|There|Then|And|But|So|Now|If|When|What|Why|How)\b)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
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

function processingLabel(processing: ProcessingInfo, language: AppLanguage): string {
  if (language === "en") {
    switch (processing.transcriptSource) {
      case "manual":
        return "Manual transcript";
      case "subtitle":
        return "Subtitles";
      case "whisper":
        return "Whisper";
      case "cache":
        return "Cache";
    }
  }

  switch (processing.transcriptSource) {
    case "manual":
      return "手动 transcript";
    case "subtitle":
      return "字幕优先";
    case "whisper":
      return "Whisper 转写";
    case "cache":
      return "缓存结果";
  }
}

function buildPageNumbers(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 10) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < totalPages) {
      pages.add(page);
    }
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const result: Array<number | "ellipsis"> = [];
  for (const page of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      result.push("ellipsis");
    }
    result.push(page);
  }
  return result;
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
