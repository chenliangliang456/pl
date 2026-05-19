require('dotenv').config();

const fs = require('fs');
const path = require('path');

const IS_VERCEL = Boolean(process.env.VERCEL);

const API_BASE_URL = String(process.env.API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const API_KEY = String(process.env.API_KEY || '').trim();

const MODEL = 'gpt-image-2';
const RESOLUTION = '1k';
const CONCURRENCY = IS_VERCEL ? 1 : 6;
const MAX_COUNT = IS_VERCEL ? 2 : 300;
const OUTPUT_DIR = IS_VERCEL ? path.join('/tmp', 'mod.peg') : path.join(__dirname, '..', 'mod.peg');

try {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
} catch (err) {
  console.warn('创建输出目录失败（可忽略）:', err.message);
}

const ALLOWED_SIZES = new Set([
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'
]);

function isApiConfigured() {
  return Boolean(API_BASE_URL && API_KEY);
}

function getHealthPayload() {
  return {
    ok: true,
    env: IS_VERCEL ? 'vercel' : 'local',
    apiConfigured: isApiConfigured(),
    maxCount: MAX_COUNT
  };
}

function normalizeSize(size) {
  return ALLOWED_SIZES.has(size) ? size : '1:1';
}

function normalizeCount(count) {
  const n = Number.parseInt(count, 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), MAX_COUNT);
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchImageBuffer(imageUrl) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`下载图片失败：${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buf, contentType };
}

function extFromContentType(contentType) {
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'png';
}

async function submitTask(prompt, size) {
  const resp = await fetch(`${API_BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
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
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`APIMart返回非JSON：${text}`);
  }

  const item = Array.isArray(data.data) ? data.data[0] : data.data;
  const taskId = item && item.task_id;
  if (!taskId) throw new Error(`未获取到 task_id：${text}`);
  return taskId;
}

async function pollTask(taskId) {
  await sleep(IS_VERCEL ? 5000 : 8000);

  for (let i = 0; i < 40; i++) {
    const resp = await fetch(`${API_BASE_URL}/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`查询任务失败 ${resp.status}：${text}`);

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`任务返回非JSON：${text}`);
    }

    const data = body.data || {};
    const status = data.status;

    if (status === 'completed') {
      const url =
        data.result &&
        data.result.images &&
        data.result.images[0] &&
        (Array.isArray(data.result.images[0].url)
          ? data.result.images[0].url[0]
          : data.result.images[0].url);
      if (!url) throw new Error('任务完成但未拿到图片URL');
      return url;
    }

    if (status === 'failed') {
      throw new Error(
        `任务失败：${(body.error && body.error.message) || JSON.stringify(body)}`
      );
    }

    await sleep(IS_VERCEL ? 3000 : 4000);
  }

  throw new Error('任务超时，请稍后重试');
}

async function generateOneImage(prompt, size, batchId, index, seed) {
  const taskId = await submitTask(prompt, size);
  const imageUrl = await pollTask(taskId);
  const { buf, contentType } = await fetchImageBuffer(imageUrl);

  const ext = extFromContentType(contentType);
  const fileName = `ai-${batchId}-${String(index).padStart(3, '0')}-${seed}.${ext}`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  let savedPath = null;
  try {
    fs.writeFileSync(filePath, buf);
    savedPath = filePath;
  } catch (err) {
    console.warn('写入磁盘失败:', err.message);
  }

  const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
  return { taskId, imageUrl, dataUrl, savedPath, fileName };
}

async function runGenerate(body) {
  if (!isApiConfigured()) {
    const err = new Error(
      '服务端未配置 API_BASE_URL / API_KEY。Vercel 请在 Settings → Environment Variables 中添加后重新部署。'
    );
    err.status = 500;
    throw err;
  }

  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    const err = new Error('请输入图片描述。');
    err.status = 400;
    throw err;
  }

  const count = normalizeCount(body.count);
  const size = normalizeSize(body.size);

  const batchId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const tasks = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    seed: randomSeed(),
    size
  }));

  const results = await runWithConcurrency(tasks, CONCURRENCY, async (t) => {
    const { taskId, dataUrl, fileName, savedPath } = await generateOneImage(
      prompt,
      size,
      batchId,
      t.id,
      t.seed
    );
    return { id: t.id, seed: t.seed, size, taskId, dataUrl, fileName, savedPath };
  });

  return {
    images: results,
    savedDir: IS_VERCEL ? null : OUTPUT_DIR,
    batchId,
    maxCount: MAX_COUNT
  };
}

module.exports = {
  getHealthPayload,
  runGenerate,
  MAX_COUNT
};
