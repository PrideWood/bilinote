# BiliNote AI 学习视频知识总结工具需求文档

## 1. 项目定位

本项目从“Bilibili 链接 AI 总结工具”调整为“本地优先的视频知识总结工具”。

用户上传本地视频文件或粘贴在线视频链接后，系统在本机完成音频提取和语音转文字，再调用用户配置的大模型 API 将 transcript 整理为适合学习和复习的知识笔记。

核心目标不是简单摘要，而是把知识视频中的概念、论证过程、知识点关系和复习材料结构化呈现。

长期产品形态参考 ActivityWatch：本地应用启动本地服务，用户通过浏览器界面使用。应用内置或管理 `ffmpeg`、`yt-dlp`、`whisper-cli` 与 Whisper 模型，普通用户尽量只需要配置自己的 API Key。

## 2. 目标用户

- 想快速消化课程、讲座、教程、会议回放的学习者。
- 需要从长视频中提取知识点、时间轴笔记和复习清单的用户。
- 希望尽量减少对第三方视频平台接口依赖的本地工作流用户。
- 希望把视频学习笔记沉淀到 Markdown / Obsidian 的用户。

## 3. MVP 功能范围

### 3.1 视频输入

前端支持上传本地视频文件，也支持粘贴在线视频 URL。

首期支持格式：

- `.mp4`
- `.mov`
- `.mkv`
- `.webm`

在线视频支持策略：

- 直链 `.mp4`、`.mov`、`.mkv`、`.webm`：由 `ffmpeg` 直接抽取音频。
- Bilibili：优先通过公开 playurl API 获取音频流并转写，页面播放可使用 Bilibili player 或原网页并列模式。
- 其他网页类在线视频：通过 `yt-dlp` 下载音频后转写。

MVP 暂不支持：

- 浏览器插件
- 多文件批量处理
- 云端账号同步

### 3.2 音频提取

后端使用 `ffmpeg` 从视频中提取音频。

音频中间文件建议统一转为：

```text
16kHz mono wav
```

示例：

```bash
ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 audio.wav
```

### 3.3 本地语音转文字

使用本地 Whisper 系方案，优先采用 `whisper.cpp`。

默认推荐模型：

```text
large-v3-turbo
```

原因：

- 比 `large-v3` 更快。
- 中文效果明显优于 `base` / `small`。
- 模型可免费下载，本地保存后无需重复下载。
- 不依赖 MacWhisper 的授权、激活或缓存状态。

推荐目录：

```text
models/
  ggml-large-v3-turbo.bin
```

MVP 转写输出：

- 原始 transcript 文本
- 带时间戳的段落
- 可选 `.srt` 文件

### 3.4 知识总结

后端继续保留大模型总结模块。

大模型输入：

- 视频文件名
- 可选用户补充说明
- transcript
- 时间戳段落

大模型输出应包括：

1. **视频概览**
   - 这个视频主要解决什么问题。
   - 适合什么学习目标。

2. **核心结论**
   - 用简洁语言列出视频最重要的结论。

3. **知识点树**
   - 按主题和层级组织知识点。
   - 不是简单罗列字幕，而是归纳概念关系。

4. **逻辑脉络**
   - 按讲解顺序展开。
   - 说明每一段如何承接上一段。

5. **时间轴笔记**
   - 带时间戳。
   - 便于用户回看原视频。

6. **术语与关键词**
   - 提取重要概念。
   - 给出简短解释。

7. **易错点 / 易误解点**
   - 标出学习时容易混淆的地方。

8. **复习清单**
   - 用问题形式帮助复习。
   - 可以作为主动回忆材料。

### 3.5 前端展示

前端首屏应是实际工具界面，而不是介绍页。

页面主要区域：

- 视频上传区
- 在线 URL 输入区
- 处理进度区
- 视频播放 / 原网页并列学习入口
- 转写结果预览
- 知识总结结果

处理状态：

```text
等待上传
上传中
提取音频中
转写中
总结中
完成
失败
```

结果展示建议使用标签页：

- 总览
- 知识点
- 逻辑脉络
- 时间轴
- 复习
- Transcript

## 4. 非目标范围

MVP 不做以下内容：

- 用户登录
- 云端文件同步
- 数据库
- 视频在线播放器的高级剪辑能力
- 多人协作
- 自动下载在线视频
- 音频说话人分离
- OCR 识别课件画面
- 逐帧图像理解

这些功能可以进入后续版本。

## 5. 技术架构

### 5.1 前端

技术栈保持：

```text
Vite + React + TypeScript
```

主要文件建议：

```text
src/
  App.tsx
  components/
    UploadPanel.tsx
    ProgressSteps.tsx
    SummaryTabs.tsx
    TranscriptViewer.tsx
  styles.css
```

### 5.2 后端

技术栈保持：

```text
Node.js + Express + TypeScript
```

主要文件建议：

```text
server/
  server.ts        # API 路由
  video.ts         # 文件上传、音频提取
  transcriber.ts   # 调用 whisper.cpp
  summarizer.ts    # 调用 DeepSeek / OpenAI-compatible API
  jobs.ts          # 内存任务状态管理
```

### 5.3 本地目录

建议目录结构：

```text
uploads/
  videos/
  audio/
  transcripts/
models/
  ggml-large-v3-turbo.bin
bin/
  whisper-cli
```

这些目录应加入 `.gitignore`。

## 6. API 设计

### 6.1 上传并创建任务

```http
POST /api/jobs
Content-Type: multipart/form-data
```

字段：

```text
video: File
language?: string
model?: string
notes?: string
```

返回：

```json
{
  "jobId": "string",
  "status": "queued"
}
```

### 6.2 查询任务状态

```http
GET /api/jobs/:jobId
```

返回：

```json
{
  "jobId": "string",
  "status": "transcribing",
  "progress": 45,
  "message": "正在转写音频",
  "result": null,
  "error": null
}
```

完成后：

```json
{
  "jobId": "string",
  "status": "done",
  "progress": 100,
  "result": {
    "video": {},
    "transcript": [],
    "summary": {}
  }
}
```

### 6.3 获取 transcript

MVP 可直接包含在 job result 中。

后续可拆分：

```http
GET /api/jobs/:jobId/transcript
```

## 7. 配置项

建议 `.env`：

```env
PORT=3001

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=

WHISPER_BIN_PATH=./bin/whisper-cli
WHISPER_MODEL_PATH=./models/ggml-large-v3-turbo.bin
WHISPER_LANGUAGE=zh

UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=2048
```

## 8. 处理流程

```text
用户上传视频
→ 后端保存视频文件
→ 创建 job
→ ffmpeg 提取音频
→ whisper.cpp 转写音频
→ 清洗 transcript
→ 调用大模型生成知识总结
→ 前端轮询 job 状态
→ 展示结果
```

## 9. 错误处理

需要清晰处理：

- 未安装 `ffmpeg`
- 未找到 `whisper-cli`
- 未找到 Whisper 模型文件
- 上传文件过大
- 视频格式不支持
- 音频提取失败
- 转写失败
- 大模型 API 失败或限流
- 大模型返回 JSON 格式异常

MVP 要求：

- 错误信息必须显示在前端。
- 后端不要让请求无限挂起。
- 若转写成功但总结失败，应展示 transcript，并提示总结失败。

## 10. 数据持久化策略

MVP 不使用数据库，但需要本地持久化历史任务。

文件保存在本地目录：

```text
uploads/
  jobs.json
```

后续可以加入：

- SQLite
- 删除任务
- 重新总结
- 全文搜索索引

## 11. Whisper 模型管理

MVP 不自动下载模型。

如果模型不存在，后端返回明确提示：

```text
未找到 Whisper 模型文件，请将 ggml-large-v3-turbo.bin 放到 models/ 目录。
```

后续可加入：

- 一键下载脚本
- 模型选择器
- 模型校验 hash
- 转写速度预估

## 11.1 Markdown 与 Obsidian

学习笔记需要可长期保存。

MVP 支持：

- 导出完整学习笔记为 `.md`。
- 配置 `OBSIDIAN_VAULT_PATH` 后，直接保存到指定 Obsidian vault。
- Markdown 包含视频来源、概览、核心结论、知识点、逻辑脉络、时间轴、术语、复习问题和完整转录。

## 12. 总结 Prompt 方向

大模型不应只做摘要。

Prompt 目标：

```text
你是一个知识视频学习助手。
请根据 transcript 生成结构化学习笔记。
不要编造 transcript 中不存在的内容。
如果内容信息不足，请明确说明。
请优先保留概念关系、推理顺序和可复习问题。
```

输出 JSON 结构建议：

```json
{
  "overview": "string",
  "coreConclusions": ["string"],
  "knowledgeTree": [
    {
      "topic": "string",
      "points": ["string"]
    }
  ],
  "logicFlow": [
    {
      "title": "string",
      "explanation": "string"
    }
  ],
  "timelineNotes": [
    {
      "timestamp": "00:00",
      "note": "string"
    }
  ],
  "terms": [
    {
      "term": "string",
      "definition": "string"
    }
  ],
  "reviewQuestions": ["string"]
}
```

## 13. 验收标准

MVP 完成后应满足：

- 可以上传一个本地视频文件。
- 可以粘贴 Bilibili 链接并走音频转文字链路。
- 后端能保存文件并提取音频。
- 后端能调用本地 Whisper 转写。
- 前端能看到处理进度。
- 转写完成后能看到 transcript。
- 总结成功后能看到知识结构化结果。
- 总结失败时 transcript 仍可查看。
- 任务历史重启后仍可查看。
- 可导出 Markdown 学习笔记。

## 14. 本地应用打包路线

目标是让更多同学无需开发环境即可使用。

推荐路线：

1. **当前阶段：本地 Web + 双击脚本**
   - 继续完善 Vite + Express 工作流。
   - 保持所有处理在本机完成。
   - 用户通过本地浏览器访问 `localhost`。

2. **打包前准备：设置页与依赖自检**
   - API Key 配置页。
   - `ffmpeg`、`yt-dlp`、`whisper-cli`、Whisper 模型检测。
   - Obsidian vault 路径配置。
   - 统一使用 app data 目录保存配置、模型、缓存和历史。

3. **macOS 本地应用**
   - 使用 Electron 壳启动本地 Node/Express server。
   - 内置前端页面。
   - 内置或管理 `ffmpeg`、`yt-dlp`、`whisper-cli`。
   - Whisper 模型可选择内置小模型或首次启动下载。
   - 提供 Dock / 菜单栏入口，默认非开机自启，退出时关闭服务。

4. **跨平台扩展**
   - macOS：`.dmg` / `.zip`。
   - Windows：`.exe` 安装包或 portable 版本。
   - Linux：`.AppImage` / `.deb`。
   - 根据平台选择对应二进制：`ffmpeg(.exe)`、`yt-dlp(.exe)`、`whisper-cli(.exe)`。
   - Whisper 模型文件跨平台复用。

5. **后续产品化可选项**
   - 自动更新 `yt-dlp`。
   - 模型下载、校验和切换。
   - 任务并发控制和资源占用提示。
   - 应用签名、notarization、license 页面。

## 15. 后续版本方向

可选迭代：

- 分块转写和分块总结。
- 支持长视频断点续跑。
- 本地历史记录。
- 多模型选择。
- 自动下载 Whisper 模型。
- OCR 提取课件文字。
- 章节切分。
- 导出 Markdown / PDF / Anki。
- 本地全文搜索。
- 知识图谱或概念关系图。
