// AI 批量文生图后端：Node.js + Express
// 聚合 API 地址与密钥从环境变量读取（本地复制 .env.example 为 .env 并填写）

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ============================================================
// 环境变量：API_BASE_URL（聚合平台根地址）、API_KEY（密钥）
// 参见仓库根目录 .env.example；勿将 .env 提交到 Git
// APIMart：https://apimart.ai · 文档见官方 images generations / tasks
// ============================================================

const API_BASE_URL = String(process.env.API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const API_KEY = String(process.env.API_KEY || '').trim();

if (!API_BASE_URL || !API_KEY) {
  console.error(
    '缺少环境变量：请在项目根目录创建 .env，配置 API_BASE_URL 与 API_KEY（可参考 .env.example）。'
  );
  process.exit(1);
}

// 文生图模型（APIMart 当前可用：gpt-image-2、gpt-4o-image）
const MODEL = 'gpt-image-2';

// 输出分辨率档位：1k / 2k / 4k（4k 仅支持 16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21）
const RESOLUTION = '1k';

// 批量生成时同时跑的任务数上限，避免一次 300 张全部并发把上游/内存打爆
const CONCURRENCY = 6;

// 自动保存目录（相对当前 server.js 所在目录），生成后立即写盘
const OUTPUT_DIR = path.join(__dirname, 'mod.peg');

// ============================================================

// 启动时确保保存目录存在
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();
const PORT = Number.parseInt(process.env.PORT || '8888', 10) || 8888;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// APIMart 支持的宽高比白名单
const ALLOWED_SIZES = new Set([
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'
]);

function normalizeSize(size) {
  return ALLOWED_SIZES.has(size) ? size : '1:1';
}

function normalizeCount(count) {
  const n = Number.parseInt(count, 10);
  if (Number.isNaN(n)) return 1;
  // 自定义数量：最小 1，最大 300
  return Math.min(Math.max(n, 1), 300);
}

// 并发队列：按 limit 同时执行，保持结果顺序与 tasks 下标一致
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

function randomSeed() {
  return Math.floor(Math.random() * 4_294_967_295);
}

// 简单延时
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 把远程图片 URL 抓回来，返回原始 buffer + contentType，便于既转 dataURL 给前端展示，又能写到磁盘
async function fetchImageBuffer(imageUrl) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`下载图片失败：${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buf, contentType };
}

// 由 contentType 推断扩展名
function extFromContentType(contentType) {
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'png';
}

// 提交一个文生图任务，返回 task_id
async function submitTask(prompt, size) {
  const resp = await fetch(`${API_BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      n: 1,
      size,
      resolution: RESOLUTION
    })
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`APIMart提交任务失败 ${resp.status}：${text}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`APIMart返回非JSON：${text}`); }

  const item = Array.isArray(data.data) ? data.data[0] : data.data;
  const taskId = item && item.task_id;
  if (!taskId) throw new Error(`未获取到 task_id：${text}`);
  return taskId;
}

// 轮询任务状态，直到 completed 或 failed，最长等 120s
async function pollTask(taskId) {
  // 文档建议先等 10~20s，再每 3~5s 轮询一次；批量场景下我们稍紧凑一点
  await sleep(8000);

  for (let i = 0; i < 40; i++) {
    const resp = await fetch(`${API_BASE_URL}/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`查询任务失败 ${resp.status}：${text}`);

    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`任务返回非JSON：${text}`); }

    const data = body.data || {};
    const status = data.status;

    if (status === 'completed') {
      const url = data.result &&
        data.result.images &&
        data.result.images[0] &&
        (Array.isArray(data.result.images[0].url) ? data.result.images[0].url[0] : data.result.images[0].url);
      if (!url) throw new Error('任务完成但未拿到图片URL');
      return url;
    }

    if (status === 'failed') {
      throw new Error(`任务失败：${(body.error && body.error.message) || JSON.stringify(body)}`);
    }

    await sleep(4000);
  }

  throw new Error('任务超时，请稍后重试');
}

// 生成单张图片：提交任务 → 轮询 → 下载图片 → 同时落盘到 mod.peg/ 并返回 dataURL 给前端
async function generateOneImage(prompt, size, batchId, index, seed) {
  const taskId = await submitTask(prompt, size);
  const imageUrl = await pollTask(taskId);
  const { buf, contentType } = await fetchImageBuffer(imageUrl);

  const ext = extFromContentType(contentType);
  const fileName = `ai-${batchId}-${String(index).padStart(3, '0')}-${seed}.${ext}`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(filePath, buf);

  const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
  return { taskId, imageUrl, dataUrl, savedPath: filePath, fileName };
}

app.post('/api/generate', async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ message: '请输入图片描述。' });
    }

    const count = normalizeCount(req.body.count);
    const size = normalizeSize(req.body.size);

    // APIMart 不支持 seed，但 gpt-image-2 每次生成自带随机性，N 个独立任务即可保证图片不同。
    // 这里给每张分配一个本地 seed 作为唯一标识，并用 batchId 把同一次批量的文件归到一起。
    const batchId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const tasks = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      seed: randomSeed(),
      size
    }));

    const results = await runWithConcurrency(tasks, CONCURRENCY, async (t) => {
      const { taskId, dataUrl, fileName, savedPath } =
        await generateOneImage(prompt, size, batchId, t.id, t.seed);
      return { id: t.id, seed: t.seed, size, taskId, dataUrl, fileName, savedPath };
    });

    return res.json({
      images: results,
      savedDir: OUTPUT_DIR,
      batchId
    });
  } catch (err) {
    console.error('生成失败：', err);
    return res.status(500).json({ message: err.message || '生成失败' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI 批量文生图服务已启动：http://0.0.0.0:${PORT}`);
  console.log(`图片自动保存目录：${OUTPUT_DIR}`);
});
