# AI 错题集 (cuoti-app)

AI 自动出题 + 错题本 Web App：把错题喂进去（文字 / 录音 / 上传音频），AI 生成变式题让你**对着错点再练**——错题本不是收纳仓库，是训练场。

**核心闭环**：错题 → AI 生成同类变式题 → 重练 → 再错的题回错题本，下一轮继续针对它出题。

## 功能

- 💬 **三种输入**：粘贴文字 / 浏览器录音（最长 3 分钟）/ 上传音频文件（≤8MB），录音走 Qwen3-ASR-Flash 识别
- 🤖 **AI 出题**：Qwen-Plus 按「3 单选 + 2 简答」出题，紧扣输入内容；后端对模型输出做**确定性规整**（选项格式 / 题型 / 唯一 ID），前端拿到就能渲染，不赌模型自觉
- 🔁 **错题重练**：错题本一键「针对这批错题生成同类变式题」，考点不变、情境换新
- 📊 **错题本**：localStorage 本地保存，记录错题、你的答案、正确答案与解析，支持一键重练与清空
- 📺 **过程可见**：语音识别 / 出题阶段按真实进度展示，可随时停止
- ⚙️ **PWA**：manifest + service worker，可安装到桌面

## 技术栈

- 前端：React + Vite + Tailwind CSS（`frontend/`）
- 后端：Node.js + Express（`backend/`，音频走 multer 落盘后转 base64 调 API）
- AI 服务：阿里云百炼（Qwen3-ASR-Flash 语音识别 + Qwen-Plus 出题）

## 项目结构

```
backend/
  server.js        # 全部后端：4 个接口 + 提示词 + 输出规整
  .env.example     # 环境变量样例（复制为 .env 后填写）
  uploads/         # 音频临时目录（自动创建，处理后即删）
frontend/
  src/App.jsx      # 首页 / 答题 / 错题本三个页面
  public/sw.js     # service worker（不缓存动态内容）
```

## API 一览

| 接口 | 说明 |
|---|---|
| `POST /api/generate` | 文字 → 题目（1-20000 字） |
| `POST /api/transcribe` | 音频 → 文字（字段名 `audio`，≤8MB） |
| `POST /api/voice-to-questions` | 音频 → 题目（一站式） |
| `POST /api/regenerate-from-wrong` | 错题列表 → 同类变式题（≤20 题） |
| `GET /api/health` | 探活，返回 Key 是否已配置 |

## 本地启动

1. **配置后端 Key**：
   ```bash
   cd backend
   cp .env.example .env   # Windows: copy .env.example .env
   # 编辑 .env，填入你的 DASHSCOPE_API_KEY（https://bailian.console.aliyun.com/ 获取）
   ```
2. **启动后端**：
   ```bash
   node server.js        # http://localhost:3001
   ```
3. **启动前端**：
   ```bash
   cd ../frontend
   npm install
   npm run dev           # http://localhost:5173，自动连本机 3001
   ```

Windows 下也可以直接双击根目录的 `start.bat` / `stop.bat`。

## 生产部署

```bash
cd frontend && npm install && npm run build   # 产出 frontend/dist
cd ../backend && node server.js               # 自动托管 dist，SPA 回退已内置
```

前端部署到独立域名时，设置 `VITE_API_BASE_URL` 指向后端地址（参考 `frontend/.env.example`）。

> ⚠️ 安全提示：`/api/generate` 等接口无鉴权，公网部署请自行加访问控制或限流，避免 API Key 被刷。仓库不含任何 Key。

## Roadmap

- [ ] 出题质量评测集（用自己的评测方法论审自己的产品）
- [ ] 简答题 LLM 判分（当前为精确匹配，过于严格）
- [ ] 练习记录与遗忘曲线
- [ ] App.jsx 组件拆分 + CI

## License

[MIT](LICENSE) © 2026 丁梦轲 (Ding Mengke)
