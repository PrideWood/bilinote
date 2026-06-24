export interface BilibiliVideoInfo {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  duration: number;
  owner?: string;
  epId?: number;
  seasonId?: number;
  pageUrl: string;
}

export interface SubtitleLine {
  from: number;
  to: number;
  content: string;
}

export interface TranscriptLine extends SubtitleLine {
  timestamp: string;
}

export interface SubtitleFetchResult {
  lines: SubtitleLine[];
  debug: SubtitleDebugInfo;
}

export interface SubtitleDebugInfo {
  sourcesChecked: string[];
  candidateCount: number;
  selectedSource?: string;
  selectedLanguage?: string;
  attemptedCount: number;
  cookieConfigured: boolean;
}

interface BilibiliViewResponse {
  code: number;
  message: string;
  data?: {
    bvid: string;
    aid: number;
    cid: number;
    title: string;
    duration: number;
    owner?: { name?: string };
    subtitle?: {
      list?: Array<{
        id: number;
        lan: string;
        lan_doc: string;
        subtitle_url: string;
      }>;
    };
  };
}

interface BilibiliSeasonResponse {
  code: number;
  message: string;
  result?: {
    season_id?: number;
    title?: string;
    episodes?: Array<{
      aid: number;
      bvid: string;
      cid: number;
      id: number;
      title?: string;
      long_title?: string;
      duration?: number;
    }>;
  };
}

interface BilibiliSubtitleResponse {
  body?: Array<{
    from: number;
    to: number;
    content: string;
  }>;
}

interface BilibiliPlayerResponse {
  code: number;
  message: string;
  data?: {
    subtitle?: {
      subtitles?: Array<{
        id: number;
        lan: string;
        lan_doc: string;
        subtitle_url: string;
      }>;
    };
  };
}

interface SubtitleCandidate {
  lan?: string;
  lan_doc?: string;
  subtitle_url: string;
  source: string;
}

const BVID_PATTERN = /BV[0-9A-Za-z]{10}/;
const AV_PATTERN = /(?:^|\/|av)(?:av)?(\d{2,})/i;
const EP_PATTERN = /ep(\d+)/i;
const SS_PATTERN = /ss(\d+)/i;

const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function buildHeaders(referer = "https://www.bilibili.com/"): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Referer: referer,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  };

  if (process.env.BILIBILI_COOKIE) {
    headers.Cookie = process.env.BILIBILI_COOKIE;
  }

  return headers;
}

export function parseBvid(input: string): string {
  const match = input.match(BVID_PATTERN);
  if (!match) {
    throw new Error("未能从链接中解析到 BV 号");
  }
  return match[0];
}

export async function fetchVideoInfo(input: string): Promise<BilibiliVideoInfo> {
  const epId = parseNumericId(input, EP_PATTERN);
  const seasonId = parseNumericId(input, SS_PATTERN);
  if (epId || seasonId) {
    return fetchPgcVideoInfo(input, epId, seasonId);
  }

  const bvid = parseBvid(input);
  return fetchArchiveVideoInfo(bvid);
}

async function fetchArchiveVideoInfo(bvid: string): Promise<BilibiliVideoInfo> {
  const url = new URL("https://api.bilibili.com/x/web-interface/view");
  url.searchParams.set("bvid", bvid);

  const response = await fetch(url, { headers: buildHeaders(videoReferer(bvid)) });
  if (!response.ok) {
    throw new Error(`获取视频信息失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as BilibiliViewResponse;
  if (payload.code !== 0 || !payload.data) {
    throw new Error(payload.message || "获取视频信息失败");
  }

  return {
    bvid: payload.data.bvid,
    aid: payload.data.aid,
    cid: payload.data.cid,
    title: payload.data.title,
    duration: payload.data.duration,
    owner: payload.data.owner?.name,
    pageUrl: videoReferer(payload.data.bvid)
  };
}

async function fetchPgcVideoInfo(
  input: string,
  epId?: number,
  seasonId?: number
): Promise<BilibiliVideoInfo> {
  const url = new URL("https://api.bilibili.com/pgc/view/web/season");
  if (epId) {
    url.searchParams.set("ep_id", String(epId));
  } else if (seasonId) {
    url.searchParams.set("season_id", String(seasonId));
  }

  const response = await fetch(url, { headers: buildHeaders(input) });
  if (!response.ok) {
    throw new Error(`获取 OGV 视频信息失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as BilibiliSeasonResponse;
  if (payload.code !== 0 || !payload.result?.episodes?.length) {
    throw new Error(payload.message || "获取 OGV 视频信息失败");
  }

  const episode =
    payload.result.episodes.find((item) => item.id === epId) ?? payload.result.episodes[0];
  const durationSeconds = episode.duration ? Math.round(episode.duration / 1000) : 0;

  return {
    bvid: episode.bvid,
    aid: episode.aid,
    cid: episode.cid,
    title: [payload.result.title, episode.long_title || episode.title].filter(Boolean).join(" - "),
    duration: durationSeconds,
    epId: episode.id,
    seasonId: payload.result.season_id,
    pageUrl: epId ? `https://www.bilibili.com/bangumi/play/ep${episode.id}` : input
  };
}

export async function fetchSubtitleLines(video: BilibiliVideoInfo): Promise<SubtitleFetchResult> {
  const checked = new Set<string>();
  const candidates = await findSubtitleCandidates(video, checked);
  const sortedCandidates = sortSubtitles(candidates);
  if (sortedCandidates.length === 0) {
    return {
      lines: [],
      debug: buildSubtitleDebug(checked, candidates)
    };
  }

  let attemptedCount = 0;
  for (const subtitle of sortedCandidates) {
    attemptedCount += 1;
    const subtitleUrl = normalizeSubtitleUrl(subtitle.subtitle_url);
    const subtitleResponse = await fetch(subtitleUrl, {
      headers: buildHeaders(video.pageUrl)
    });
    if (!subtitleResponse.ok) {
      continue;
    }

    const subtitlePayload = (await subtitleResponse.json()) as BilibiliSubtitleResponse;
    const lines = (subtitlePayload.body ?? []).map((line) => ({
      from: line.from,
      to: line.to,
      content: cleanSubtitleText(line.content)
    }));

    if (lines.length > 0) {
      return {
        lines,
        debug: buildSubtitleDebug(checked, candidates, subtitle, attemptedCount)
      };
    }
  }

  return {
    lines: [],
    debug: buildSubtitleDebug(checked, candidates, undefined, attemptedCount)
  };
}

async function findSubtitleCandidates(
  video: BilibiliVideoInfo,
  checked: Set<string>
): Promise<SubtitleCandidate[]> {
  const candidates = [
    ...(await fetchPlayerSubtitleCandidates(video, checked)),
    ...(await fetchPgcPlayerSubtitleCandidates(video, checked)),
    ...(await fetchPageSubtitleCandidates(video, checked))
  ];

  const seen = new Set<string>();
  return candidates.filter((item) => {
    const url = normalizeSubtitleUrl(item.subtitle_url);
    if (!url || seen.has(url)) {
      return false;
    }
    seen.add(url);
    return true;
  });
}

async function fetchPlayerSubtitleCandidates(
  video: BilibiliVideoInfo,
  checked: Set<string>
): Promise<SubtitleCandidate[]> {
  const url = new URL("https://api.bilibili.com/x/player/v2");
  url.searchParams.set("bvid", video.bvid);
  url.searchParams.set("aid", String(video.aid));
  url.searchParams.set("cid", String(video.cid));
  checked.add("x/player/v2");

  const response = await fetch(url, { headers: buildHeaders(video.pageUrl) });
  if (!response.ok) {
    throw new Error(`获取字幕列表失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as BilibiliPlayerResponse;
  if (payload.code !== 0) {
    throw new Error(payload.message || "获取字幕列表失败");
  }

  const subtitles = payload.data?.subtitle?.subtitles ?? [];
  return subtitles
    .filter((item) => item.subtitle_url)
    .map((item) => ({
      lan: item.lan,
      lan_doc: item.lan_doc,
      subtitle_url: item.subtitle_url,
      source: "player"
    }));
}

async function fetchPgcPlayerSubtitleCandidates(
  video: BilibiliVideoInfo,
  checked: Set<string>
): Promise<SubtitleCandidate[]> {
  if (!video.epId) {
    return [];
  }

  const urls = [
    new URL("https://api.bilibili.com/pgc/player/web/v2"),
    new URL("https://api.bilibili.com/pgc/player/web/v2/playurl")
  ];
  const candidates: SubtitleCandidate[] = [];

  for (const url of urls) {
    url.searchParams.set("bvid", video.bvid);
    url.searchParams.set("aid", String(video.aid));
    url.searchParams.set("cid", String(video.cid));
    url.searchParams.set("ep_id", String(video.epId));
    checked.add(url.pathname.replace(/^\/+/, ""));

    const response = await fetch(url, { headers: buildHeaders(video.pageUrl) });
    if (!response.ok) {
      continue;
    }

    const payload = (await response.json()) as unknown;
    candidates.push(...extractSubtitleCandidatesFromUnknown(payload, "pgc-player"));
  }

  return candidates;
}

async function fetchPageSubtitleCandidates(
  video: BilibiliVideoInfo,
  checked: Set<string>
): Promise<SubtitleCandidate[]> {
  checked.add("video-page-html");
  const response = await fetch(video.pageUrl, {
    headers: buildHeaders(video.pageUrl)
  });

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const candidates: SubtitleCandidate[] = [];
  const patterns = [
    /"subtitle_url"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /"subtitleUrl"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /"url"\s*:\s*"((?:\\.|[^"\\])*(?:subtitle|bfs\/subtitle|\/subtitles?\/)(?:\\.|[^"\\])*)"/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const subtitleUrl = decodeJsonString(match[1]);
      if (subtitleUrl) {
        candidates.push({ subtitle_url: subtitleUrl, source: "page" });
      }
    }
  }

  return candidates;
}

function sortSubtitles(candidates: SubtitleCandidate[]): SubtitleCandidate[] {
  return [...candidates].sort((a, b) => subtitlePriority(a) - subtitlePriority(b));
}

function subtitlePriority(candidate: SubtitleCandidate): number {
  const language = `${candidate.lan ?? ""} ${candidate.lan_doc ?? ""}`;
  if (/zh-CN|中文|中国|简体/i.test(language)) {
    return 0;
  }
  if (/zh/i.test(language)) {
    return 1;
  }
  return 2;
}

function extractSubtitleCandidatesFromUnknown(value: unknown, source: string): SubtitleCandidate[] {
  const candidates: SubtitleCandidate[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const record = node as Record<string, unknown>;
    const rawUrl = record.subtitle_url ?? record.subtitleUrl ?? record.url;
    if (typeof rawUrl === "string" && looksLikeSubtitleUrl(rawUrl)) {
      candidates.push({
        lan: typeof record.lan === "string" ? record.lan : undefined,
        lan_doc: typeof record.lan_doc === "string" ? record.lan_doc : undefined,
        subtitle_url: rawUrl,
        source
      });
    }

    Object.values(record).forEach(visit);
  };

  visit(value);
  return candidates;
}

function looksLikeSubtitleUrl(url: string): boolean {
  return /subtitle|bfs\/subtitle|\/subtitles?\//i.test(url);
}

function buildSubtitleDebug(
  checked: Set<string>,
  candidates: SubtitleCandidate[],
  selected?: SubtitleCandidate,
  attemptedCount = 0
): SubtitleDebugInfo {
  return {
    sourcesChecked: [...checked],
    candidateCount: candidates.length,
    selectedSource: selected?.source,
    selectedLanguage: selected?.lan_doc ?? selected?.lan,
    attemptedCount,
    cookieConfigured: Boolean(process.env.BILIBILI_COOKIE)
  };
}

export function buildTranscript(lines: SubtitleLine[]): TranscriptLine[] {
  return lines
    .map((line) => ({
      ...line,
      content: cleanSubtitleText(line.content),
      timestamp: formatTimestamp(line.from)
    }))
    .filter((line) => line.content.length > 0);
}

export function transcriptToText(lines: TranscriptLine[]): string {
  return lines.map((line) => `[${line.timestamp}] ${line.content}`).join("\n");
}

export function isTranscriptRelevantToTitle(title: string, lines: TranscriptLine[]): boolean {
  const keywords = extractTitleKeywords(title);
  if (keywords.length === 0) {
    return true;
  }

  const transcriptSample = lines
    .slice(0, 160)
    .map((line) => line.content)
    .join(" ");
  const matchedKeywords = keywords.filter((keyword) =>
    transcriptSample.toLowerCase().includes(keyword.toLowerCase())
  );

  return matchedKeywords.length > 0;
}

function normalizeSubtitleUrl(url: string): string {
  const decodedUrl = url.replaceAll("\\u002F", "/").replaceAll("\\/", "/");
  if (decodedUrl.startsWith("//")) {
    return `https:${decodedUrl}`;
  }
  if (decodedUrl.startsWith("http://")) {
    return decodedUrl.replace("http://", "https://");
  }
  return decodedUrl;
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function cleanSubtitleText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractTitleKeywords(title: string): string[] {
  const stopwords = new Set([
    "如何",
    "怎么",
    "视频",
    "分享",
    "经验",
    "一个",
    "这个",
    "那个",
    "什么",
    "为什么"
  ]);
  const normalizedTitle = title.replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, " ");
  const tokens = normalizedTitle
    .split(/\s+/)
    .flatMap((chunk) => splitKeywordChunk(chunk))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopwords.has(token));

  return [...new Set(tokens)];
}

function splitKeywordChunk(chunk: string): string[] {
  if (/^[A-Za-z0-9]+$/.test(chunk)) {
    return [chunk];
  }

  if (chunk.length <= 4) {
    return [chunk];
  }

  const words = chunk.match(/[上传外挂字幕制作删除投稿允许管理设置教程指南开箱评测剪辑学习笔记总结]+/gu);
  if (words?.length) {
    return words.flatMap((word) => (word.length <= 4 ? [word] : toBigrams(word)));
  }

  return toBigrams(chunk);
}

function toBigrams(text: string): string[] {
  const bigrams: string[] = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    bigrams.push(text.slice(index, index + 2));
  }
  return bigrams;
}

function parseNumericId(input: string, pattern: RegExp): number | undefined {
  const match = input.match(pattern);
  return match?.[1] ? Number(match[1]) : undefined;
}

function videoReferer(bvid: string): string {
  return `https://www.bilibili.com/video/${bvid}/`;
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
