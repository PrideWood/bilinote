# BiliNote AI

本地视频知识总结工具。用户上传本地视频后，后端提取音频、调用本地 Whisper 转写，再用 DeepSeek 或 OpenAI-compatible 大模型生成结构化知识笔记。

当前仍保留早期 Bilibili 接口代码，但主方向已经切换为本地视频工作流。

## 目录结构

```text
.
├── docs
│   ├── implementation-log.md
│   └── local-video-knowledge-summary-requirements.md
├── server
│   ├── bilibili.ts      # 早期 Bilibili 实验接口，暂保留
│   ├── jobs.ts          # 内存任务状态
│   ├── server.ts        # Express API 路由
│   ├── summarizer.ts    # DeepSeek / OpenAI-compatible 知识总结
│   ├── transcriber.ts   # whisper.cpp 转写调用
│   ├── video.ts         # 上传目录和 ffmpeg 音频提取
│   └── tsconfig.json
├── src
│   ├── App.tsx          # 本地视频上传与总结页面
│   ├── main.tsx
│   ├── styles.css
│   └── vite-env.d.ts
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

## 运行

```bash
npm install
npm run dev
```

前端默认运行在 [http://localhost:5173](http://localhost:5173)，如果端口被占用，Vite 会自动切到下一个端口。后端默认运行在 [http://localhost:3001](http://localhost:3001)。

## 当前 MVP 范围

- 支持上传本地视频文件，格式包括 `.mp4`、`.mov`、`.mkv`、`.webm`。
- 使用 `ffmpeg` 提取 16kHz mono wav 音频。
- 预留 `whisper.cpp` 本地转写。
- 支持手动粘贴 transcript 跳过转写，直接验证知识总结。
- 使用 DeepSeek / OpenAI-compatible API 生成知识笔记。
- 前端轮询任务状态并展示进度。
- 总结结果包括总览、核心结论、知识点树、逻辑脉络、时间轴、术语、复习问题和 transcript。
- Transcript 会在后端合并为更自然的句段展示，同时保留原始片段用于 SRT 导出。
- 支持导出 transcript 为 `.txt` 和 `.srt`。

## 可用脚本

```bash
npm run dev        # 同时启动 Vite 前端和 Express 后端
npm run typecheck  # 前后端 TypeScript 类型检查
npm run build      # 构建 server 和 client
```

## 备注

- `uploads/`、`models/`、`bin/` 已加入 `.gitignore`。
- 目前任务状态存在内存里，重启服务后历史任务会丢失。
- 下一步可以加入 whisper.cpp 下载脚本、模型检测页和完整视频转写验证。
