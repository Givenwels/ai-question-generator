// ============================================================
// server.js —— 语音/文字 → AI 出题 后端服务
// 端口：.env PORT 或 3001
// ============================================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

// ---------- 通用中间件 ----------
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ---------- multer 配置：接收音频文件 ----------
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 最大 8MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.aac', '.amr', '.flac', '.webm', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('音频格式不支持，仅接受 mp3/wav/m4a/aac/amr/flac/webm/ogg'));
    }
  }
});

// ============================================================
// 系统提示词：出题老师
// ============================================================
const SYSTEM_PROMPT_QUIZ = `
你是专业的出题老师。根据用户提供的学习内容，生成 5 道题目（3 道单选题 + 2 道简答题）。
严格按以下 JSON 输出，不要任何多余文字或 markdown：
{
  "questions": [
    {
      "id": 1,
      "type": "single_choice",
      "question": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "A",
      "explanation": "为什么这个答案对，其他选项为什么错"
    },
    {
      "id": 4,
      "type": "short_answer",
      "question": "...",
      "answer": "参考答案",
      "explanation": "答题要点"
    }
  ]
}
要求：紧扣内容、难度适中、重点考察易混淆和易错知识点。
`;

// ============================================================
// 工具函数：根据扩展名 → MIME 类型
// ============================================================
function extToMediaType(ext) {
  const map = {
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
    '.m4a': 'audio/m4a',
    '.aac': 'audio/aac',
    '.amr': 'audio/amr',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg'
  };
  return map[ext] || 'audio/mp3';
}

// ============================================================
// 核心函数 1：callLLM(text) → 调用千问 qwen-plus 出题
// ============================================================
async function callLLM(text) {
  console.log('[LLM] 开始调用 qwen-plus，文本长度:', text.length);

  const body = {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_QUIZ },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' }
  };

  const res = await axios.post(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    body,
    {
      headers: {
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 秒超时
    }
  );

  const content = res.data.choices[0].message.content;
  const parsed = JSON.parse(content);
  console.log('[LLM] 完成，生成题目数:', parsed.questions?.length);
  return parsed.questions;
}

// ============================================================
// 核心函数 2：callASR(filePath, originalName) → 调用 Qwen3-ASR-Flash
// ============================================================
async function callASR(filePath, originalName) {
  console.log('[ASR] 开始语音识别，文件:', originalName);

  // 读取文件并转 base64
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');
  const ext = path.extname(originalName).toLowerCase();
  const mediaType = extToMediaType(ext);
  const dataUri = `data:${mediaType};base64,${base64Data}`;
  console.log('[ASR] 文件大小:', (fileBuffer.length / 1024).toFixed(1), 'KB, mediaType:', mediaType);

  // 构造 Qwen3-ASR-Flash 请求体
  const body = {
    model: 'qwen3-asr-flash',
    input: {
      messages: [
        { content: [{ text: '' }], role: 'system' },
        { content: [{ audio: dataUri }], role: 'user' }
      ]
    },
    parameters: {
      asr_options: { enable_itn: false }
    }
  };

  const res = await axios.post(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    body,
    {
      headers: {
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 90000 // 90 秒超时
    }
  );

  // 从响应中提取识别文字
  const transcript = res.data.output.choices[0].message.content[0].text;
  console.log('[ASR] 识别完成，文字长度:', transcript.length);
  return transcript;
}

// ============================================================
// 接口 A：POST /api/generate（文字 → 题目）
// ============================================================
app.post('/api/generate', async (req, res) => {
  try {
    console.log('[请求] POST /api/generate');
    const { text } = req.body;

    // 参数校验
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: '请提供 text 字段' });
    }
    if (text.length < 1 || text.length > 20000) {
      return res.status(400).json({ success: false, error: 'text 长度需在 1-20000 之间' });
    }

    const startTime = Date.now();
    const questions = await callLLM(text);
    console.log('[LLM] 耗时:', (Date.now() - startTime) / 1000, '秒');

    res.json({ success: true, questions });
  } catch (err) {
    console.error('[接口A 错误]', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: err.response?.data?.error?.message || err.message || 'AI 出题失败，请稍后重试'
    });
  }
});

// ============================================================
// 接口 B：POST /api/transcribe（音频 → 文字）
// ============================================================
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    console.log('[请求] POST /api/transcribe');

    // 校验是否上传了文件
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传音频文件，字段名为 audio' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    const startTime = Date.now();
    const transcript = await callASR(filePath, originalName);
    console.log('[ASR] 耗时:', (Date.now() - startTime) / 1000, '秒');

    // 处理完删除临时文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true, transcript });
  } catch (err) {
    console.error('[接口B 错误]', err.response?.data || err.message);

    // 清理临时文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: err.response?.data?.message || err.message || '语音识别失败，请稍后重试'
    });
  }
});

// ============================================================
// 接口 C：POST /api/voice-to-questions（一站式：音频 → 题目）
// ============================================================
app.post('/api/voice-to-questions', upload.single('audio'), async (req, res) => {
  try {
    console.log('[请求] POST /api/voice-to-questions');

    // 校验是否上传了文件
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传音频文件，字段名为 audio' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    // 第一步：语音转文字
    const asrStart = Date.now();
    const transcript = await callASR(filePath, originalName);
    console.log('[一站式 ASR] 耗时:', (Date.now() - asrStart) / 1000, '秒');

    // 清理临时文件（识别完即可删除）
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 第二步：文字出题
    const llmStart = Date.now();
    const questions = await callLLM(transcript);
    console.log('[一站式 LLM] 耗时:', (Date.now() - llmStart) / 1000, '秒');

    res.json({ success: true, transcript, questions });
  } catch (err) {
    console.error('[接口C 错误]', err.response?.data || err.message);

    // 清理临时文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: err.response?.data?.message || err.message || '一站式处理失败，请稍后重试'
    });
  }
});

// ============================================================
// 全局错误处理：multer 文件过大 / 格式错误
// ============================================================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: '文件大小超过 8MB 限制' });
    }
    return res.status(400).json({ success: false, error: '文件上传错误：' + err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

// ============================================================
// 启动服务
// ============================================================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
