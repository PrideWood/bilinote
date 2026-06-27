# BiliNote AI

BiliNote AI 是一个本地运行的视频学习笔记工具。它可以处理本地视频或在线视频链接，优先读取可用字幕，必要时使用本地 whisper.cpp 转写音频，再调用 DeepSeek、OpenAI 或 OpenAI-compatible 大模型生成结构化学习笔记、知识点和思维导图。

## 功能

- 上传本地视频：支持 `.mp4`、`.mov`、`.mkv`、`.webm`。
- 粘贴在线视频链接：支持 YouTube、Bilibili、直链视频等。
- 字幕优先：在线视频会先尝试抓取字幕；未抓到可用字幕时回退到 Whisper 转写。
- 本地转写：通过 whisper.cpp 的 `whisper-cli` 处理音频。
- 知识总结：生成概览、核心结论、知识点树、逻辑脉络、时间轴、术语和复习问题。
- 思维导图：单独调用大模型，按视频顺序生成概括性、多层级导图，节点可折叠、缩放、拖拽，并可跳转到对应视频时刻。
- 导出：支持 `.txt`、`.srt`、Markdown 笔记导出，也可保存到 Obsidian vault。
- 历史记录：任务记录保存在本地 `uploads/jobs.json`。

## 环境要求

基础运行：

- Node.js 20+
- npm

完整视频处理建议安装：

- `ffmpeg`：抽取音频、读取内封字幕。
- `yt-dlp`：下载在线视频音频和字幕。
- `whisper.cpp` 的 `whisper-cli`：本地语音转文字。
- 一个 ggml Whisper 模型文件，例如 `ggml-large-v3-turbo.bin`。

macOS 可参考：

```bash
brew install ffmpeg yt-dlp
```

`whisper-cli` 可以通过 Homebrew 安装 whisper.cpp，或自行从 whisper.cpp 编译/下载适合本机的可执行文件。只要 `whisper-cli` 在 PATH 中即可；也可以在 `.env` 中设置 `WHISPER_BIN_PATH` 指向它。模型文件可在应用设置中安装，也可以手动放到 `./models/`。

如果暂时没有 `whisper-cli` 或模型，仍可使用“手动 transcript”或有字幕的在线视频来验证总结链路。

macOS + Homebrew 用户也可以在应用右上角“设置 -> 系统依赖”中检查并一键安装 `ffmpeg`、`yt-dlp` 和 `whisper-cpp`。如果必需依赖已经齐全，弹窗会自动关闭。

## 快速开始

```bash
git clone https://github.com/PrideWood/bilinote.git
cd bilinote
npm install
cp .env.example .env
npm run dev
```

默认地址：

- 前端：[http://localhost:5173](http://localhost:5173)
- 后端：[http://localhost:3001](http://localhost:3001)

如果 `5173` 被占用，Vite 会提示并切换到下一个可用端口，请以终端输出为准。

## 配置

复制 `.env.example` 后按需填写。

### 大模型

推荐使用 DeepSeek：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

也可以使用 OpenAI 或兼容接口：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
```

前端设置面板里也可以临时填写 API key、Base URL 和模型名。前端填写的配置会随任务请求发送到本地后端。

### Transcript 和思维导图

```env
OPENAI_TIMEOUT_MS=60000
OPENAI_MAX_TOKENS=1000
MAX_TRANSCRIPT_CHARS=4000
TRANSCRIPT_CORRECTION_TIMEOUT_MS=60000
TRANSCRIPT_CORRECTION_MAX_TOKENS=3000
OPENAI_MIND_MAP_MAX_TOKENS=2500
MIND_MAP_TRANSCRIPT_CHUNK_CHARS=5000
```

说明：

- `MAX_TRANSCRIPT_CHARS` 控制主总结请求送给模型的 transcript 长度。
- 思维导图是单独请求，会按 `MIND_MAP_TRANSCRIPT_CHUNK_CHARS` 分块，避免长视频只覆盖开头内容。
- 如果导图层级太浅或内容太少，可以适当提高 `OPENAI_MIND_MAP_MAX_TOKENS`。

### Whisper

```env
WHISPER_BIN_PATH=whisper-cli
WHISPER_MODEL_PATH=./models/ggml-large-v3-turbo.bin
WHISPER_MODELS_DIR=./models
WHISPER_LANGUAGE=zh
```

注意：

- 这里选择的是模型文件，不是运行时精度开关。
- 如果要使用 int8、Q8、F16 等量化/精度变体，通常需要准备对应的 ggml 模型文件，再把 `WHISPER_MODEL_PATH` 指向它。
- `WHISPER_LANGUAGE` 传给 `whisper-cli -l`。如果视频语种经常变化，可以改成 `auto` 或按任务调整。

### 在线视频和字幕

```env
ONLINE_VIDEO_DOWNLOADER_BIN_PATH=yt-dlp
ONLINE_SUBTITLE_LANGS=
```

未设置 `ONLINE_SUBTITLE_LANGS` 时，后端会根据视频标题推断字幕优先级：

- 中文标题：优先中文字幕。
- 英文标题：优先英文字幕。
- 日文标题：优先日文字幕。
- 韩文标题：优先韩文字幕。
- 判断不出时：默认优先英文，再中文。

如果你想强制抓英文原字幕，可以设置：

```env
ONLINE_SUBTITLE_LANGS=en.*,en
```

如果你想强制抓中文字幕，可以设置：

```env
ONLINE_SUBTITLE_LANGS=zh-CN,zh-Hans,zh
```

### Obsidian

```env
OBSIDIAN_VAULT_PATH=/Users/你的用户名/Documents/你的Obsidian仓库
OBSIDIAN_NOTES_DIR=BiliNote
```

配置后，可以在详情页右上角菜单中把 Markdown 笔记保存到指定 vault。未配置时仍可下载 `.md` 文件。

## 常用命令

```bash
npm run dev        # 同时启动 Vite 前端和 Express 后端
npm run typecheck  # 前后端 TypeScript 类型检查
npm run build      # 构建 server 和 client
```

macOS 用户也可以双击：

- `scripts/start-bilinote.command`
- `scripts/stop-bilinote.command`

## 目录结构

```text
.
├── docs
├── public
├── scripts
├── server
│   ├── bilibili.ts
│   ├── jobs.ts
│   ├── server.ts
│   ├── summarizer.ts
│   ├── transcriber.ts
│   └── video.ts
├── src
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── .env.example
├── package.json
└── vite.config.ts
```

## 常见问题

### 为什么同一个 YouTube 视频有时字幕优先，有时回退 Whisper？

在线视频字幕依赖 `yt-dlp` 和平台当时返回的字幕轨。如果没有下载到可用字幕文件，系统会回退到 Whisper。可以通过 `ONLINE_SUBTITLE_LANGS` 强制指定语言，或更新本地 `yt-dlp`。

### 为什么英文视频会得到中文字幕？

YouTube 有时会提供自动翻译字幕轨。此前默认中文优先时，可能会抓到 `zh-Hans` 字幕。现在未配置 `ONLINE_SUBTITLE_LANGS` 时，会根据视频标题自动调整语种优先级。

### Whisper 低精度是否需要改代码？

通常不是改一行参数，而是准备对应量化/精度的模型文件，例如 Q8、Q5、F16 版本，然后选择该模型文件运行。当前项目先暴露模型文件选择，暂未做精度模式 UI。

## 本地数据

以下目录不提交到仓库：

- `uploads/`：任务历史、音频、字幕、转录缓存。
- `models/`：Whisper 模型文件。
- `bin/`：本地可执行文件，如 `whisper-cli`。
- `.env`：本地密钥和路径配置。
