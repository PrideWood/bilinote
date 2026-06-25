# 实施日志

## 2026-06-24

- 初始化本地视频知识总结改造。
- 确认本机已安装 `ffmpeg 8.1`，可以用于音频提取。
- 安装 `multer` 与类型定义，用于 Express 文件上传。
- 新增后端任务状态模块 `server/jobs.ts`。
- 新增视频处理模块 `server/video.ts`，负责本地目录与 `ffmpeg` 音频提取。
- 新增转写模块 `server/transcriber.ts`，预留 `whisper.cpp` 调用，并支持手动 transcript 解析。
- 扩展 `server/summarizer.ts`，新增知识视频结构化总结输出。
- 新增 `/api/jobs` 与 `/api/jobs/:jobId`，支持创建任务和轮询状态。
- 改造前端为本地视频上传工作台，支持手动 transcript、任务进度和多标签知识笔记展示。
- 使用手动 transcript 验证端到端任务流，任务可完成并返回知识总结。
- 下载 `whisper.cpp` 模型 `ggml-large-v3-turbo.bin` 到 `models/`，文件大小约 1.5GB。
- 通过 Homebrew 安装 `whisper-cpp 1.9.1`，并创建 `bin/whisper-cli` 指向 `/opt/homebrew/bin/whisper-cli`。
- 使用 whisper.cpp 官方 `jfk.wav` 样本验证本地转写链路，确认 large-v3-turbo 模型、Metal 后端、txt/srt 输出均可用。
- 为转写模块增加空音频保护，避免无音轨或空 wav 导致 `whisper-cli` 崩溃。
- 增强大模型 JSON 解析容错，处理尾逗号、代码块、截断 JSON；解析失败时降级为本地知识笔记，避免任务整体失败。
- 修复上传文件名乱码问题，针对 multipart 文件名常见 mojibake 做 UTF-8 还原。
- 增加 transcript 自然断句合并，前端展示合并后的句段，保留原始 Whisper 片段。
- 增加 transcript 导出接口：`/api/jobs/:jobId/transcript.txt` 和 `/api/jobs/:jobId/transcript.srt`，前端提供下载入口。

## 2026-06-25

- 将数据目录从项目内 `uploads/`、`models/` 迁移到系统 app data 目录，避免桌面应用运行时污染源码目录。
- 新增历史任务持久化、历史列表、标题编辑和任务删除能力。
- 增加本地字幕文件输入、内嵌字幕提取、在线视频字幕优先、Whisper 强制转写等处理模式。
- 增加 Bilibili / YouTube / 视频直链入口，并保留本地上传入口。
- 增加 Whisper 模型列表与下载接口，前端可选择/安装本地模型。
- 增加 Markdown 笔记导出与保存到 Obsidian vault 的接口。
- 增加本地服务启动脚本、macOS 双击脚本与简易 `.app` 启动路线。
- 开始个人版 Tauri 壳改造：安装 Tauri npm 依赖，准备 `src-tauri` 工程骨架，让桌面壳启动本地 Express 服务并嵌入 React 前端。
- 通过 Homebrew 安装 Rust/Cargo：`rustc 1.96.0`、`cargo 1.96.0`。
- 修复 Tauri Cargo 配置、图标路径和 Rust 退出清理逻辑，`npm run tauri:dev` 已可启动桌面窗口并自动拉起本地 Express 服务。
- 新增 Tauri sidecar 准备脚本 `scripts/prepare-tauri-sidecars.mjs`，按当前 target triple 生成 `node`、`ffmpeg`、`yt-dlp`、`whisper-cli` sidecar 文件。
- Tauri build 已通过，生成 `src-tauri/target/release/bundle/macos/BiliNote AI.app` 和 `src-tauri/target/release/bundle/dmg/BiliNote AI_0.1.0_aarch64.dmg`。
- 直接运行打包后的 `.app` 主二进制后，健康接口 `/api/health` 可用，server 由 `Contents/MacOS/node` sidecar 启动。
- 当前分发限制：sidecar 仍来自 Homebrew，`node` / `ffmpeg` 有 `/opt/homebrew` 动态库依赖，`yt-dlp` 是 Homebrew Python wrapper；跨机器分发前需要替换为官方 standalone/static 二进制或同步打包依赖库。
