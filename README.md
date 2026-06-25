# BiliNote AI

视频知识总结工具。用户上传本地视频或粘贴在线视频链接后，后端提取音频、调用本地 Whisper 转写，再用 DeepSeek 或 OpenAI-compatible 大模型生成结构化知识笔记。

当前仍保留早期 Bilibili 字幕接口代码，但主方向已经切换为音频转写工作流。

## 目录结构

```text
.
├── docs
│   ├── implementation-log.md
│   └── local-video-knowledge-summary-requirements.md
├── server
│   ├── bilibili.ts      # 早期 Bilibili 实验接口，暂保留
│   ├── jobs.ts          # 任务状态与历史持久化
│   ├── paths.ts         # app data、上传、模型和日志目录
│   ├── server.ts        # Express API 路由
│   ├── summarizer.ts    # DeepSeek / OpenAI-compatible 知识总结
│   ├── transcriber.ts   # whisper.cpp 转写调用
│   ├── video.ts         # 上传目录和 ffmpeg 音频提取
│   └── tsconfig.json
├── src
│   ├── App.tsx          # 视频上传、URL 转写与总结页面
│   ├── main.tsx
│   ├── styles.css
│   └── vite-env.d.ts
├── src-tauri            # 个人版 Tauri 桌面壳
├── .env.example
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 环境变量

复制示例文件并填写 API key：

```bash
cp .env.example .env
```

推荐使用 DeepSeek：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

本地 Whisper 配置：

```env
WHISPER_BIN_PATH=./bin/whisper-cli
WHISPER_MODEL_PATH=./models/ggml-large-v3-turbo.bin
WHISPER_LANGUAGE=zh
```

如果暂时没有 Whisper 模型，可以在页面粘贴手动 transcript，先验证知识总结链路。

在线视频配置：

```env
ONLINE_VIDEO_DOWNLOADER_BIN_PATH=yt-dlp
```

直链 `.mp4`、`.webm`、`.mov`、`.mkv` 可以直接由 `ffmpeg` 抽音频。Bilibili、YouTube 等网页类链接需要本机安装 `yt-dlp`，或把 `ONLINE_VIDEO_DOWNLOADER_BIN_PATH` 指到可执行文件。

Obsidian 保存配置：

```env
OBSIDIAN_VAULT_PATH=/Users/你的用户名/Documents/你的Obsidian仓库
OBSIDIAN_NOTES_DIR=BiliNote
```

配置后，可以在详情页右上角三个点菜单中把 Markdown 笔记直接保存到指定 vault 的 `BiliNote/` 目录。未配置时仍可下载 `.md` 文件。

## 运行

```bash
npm install
npm run dev
```

前端默认运行在 [http://localhost:5173](http://localhost:5173)，如果端口被占用，Vite 会自动切到下一个端口。后端默认运行在 [http://localhost:3001](http://localhost:3001)。

### 个人 Tauri 版

Tauri 版目前面向自己使用：壳负责启动本地 Express 服务，窗口内加载同一套 React 前端。

前置条件：

```bash
rustc --version
cargo --version
```

本机未安装 Rust/Cargo 时，`npm run tauri:dev` 会停在 `cargo metadata`。

安装 Rust 后运行：

```bash
npm run tauri:dev
```

打包：

```bash
npm run tauri:build
```

`tauri:dev` 和 `tauri:build` 会先运行：

```bash
npm run tauri:prepare-sidecars
```

该脚本会根据 Rust target triple 生成 Tauri 需要的 sidecar 文件，例如：

```text
src-tauri/sidecars/node-aarch64-apple-darwin
src-tauri/sidecars/ffmpeg-aarch64-apple-darwin
src-tauri/sidecars/yt-dlp-aarch64-apple-darwin
src-tauri/sidecars/whisper-cli-aarch64-apple-darwin
```

可以用环境变量指定更适合分发的二进制：

```bash
TAURI_NODE_BIN=/path/to/node \
TAURI_FFMPEG_BIN=/path/to/ffmpeg \
TAURI_YT_DLP_BIN=/path/to/yt-dlp \
TAURI_WHISPER_CLI_BIN=/path/to/whisper-cli \
npm run tauri:build
```

注意：当前默认从本机 PATH / Homebrew 复制二进制，已经可以生成本机可运行的 `.app` / `.dmg`，但不等于跨机器完整分发。`node` / `ffmpeg` 可能链接 `/opt/homebrew` 动态库，`yt-dlp` 可能是 Homebrew Python wrapper。给别人安装前需要替换为 standalone/static 构建，或把相关 dylib / runtime 一起打包。

## 当前 MVP 范围

- 支持上传本地视频文件，格式包括 `.mp4`、`.mov`、`.mkv`、`.webm`。
- 支持粘贴在线视频链接，并继续走音频转文字链路，不依赖字幕文件。
- 使用 `ffmpeg` 提取 16kHz mono wav 音频。
- 网页类在线视频可通过 `yt-dlp` 下载音频后转写。
- 预留 `whisper.cpp` 本地转写。
- 支持手动粘贴 transcript 跳过转写，直接验证知识总结。
- 使用 DeepSeek / OpenAI-compatible API 生成知识笔记。
- 前端轮询任务状态并展示进度。
- 总结结果包括总览、核心结论、知识点树、逻辑脉络、时间轴、术语、复习问题和 transcript。
- Transcript 会在后端合并为更自然的句段展示，同时保留原始片段用于 SRT 导出。
- 支持导出 transcript 为 `.txt` 和 `.srt`。
- 支持导出完整学习笔记为 `.md`，也可保存到 Obsidian vault。
- 支持历史任务持久化、标题编辑、删除任务和模型选择/下载入口。

## 可用脚本

```bash
npm run dev        # 同时启动 Vite 前端和 Express 后端
npm run typecheck  # 前后端 TypeScript 类型检查
npm run build      # 构建 server 和 client
npm run tauri:dev  # 启动个人版 Tauri 桌面壳
npm run tauri:build # 构建 Tauri 应用
npm run tauri:prepare-sidecars # 生成当前平台的 Tauri sidecar 二进制
```

## 备注

- `uploads/`、`models/`、`bin/` 已加入 `.gitignore`。
- 新版本会优先使用系统 app data 目录保存任务历史、上传文件、模型和日志；旧的项目内 `uploads/`、`models/` 会在首次启动时尽量迁移。
- 下一步可以把当前 Homebrew sidecar 替换为官方 standalone/static 构建，并补签名、notarization 与自动更新。
