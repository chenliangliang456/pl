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
const MAX_COUNT = 50;
const SUBMIT_CHUNK = IS_VERCEL ? 10 : 50;
const SUBMIT_CONCURRENCY = IS_VERCEL ? 10 : 15;
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
    maxCount: MAX_COUNT,
    submitChunk: SUBMIT_CHUNK,
    mode: 'async'
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

function randomSeed() {
  return Math.floor(Math.random() * 4_294_967_295);
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

function assertApiConfigured() {
  if (!isApiConfigured()) {
    const err = new Error(
      '服务端未配置 API_BASE_URL / API_KEY。Vercel 请在 Settings → Environment Variables 中添加后重新部署。'
    );
    err.status = 500;
    throw err;
  }
}

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

async function queryTaskOnce(taskId) {
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
    return { status: 'completed', imageUrl: url };
  }

  if (status === 'failed') {
    return {
      status: 'failed',
      message: (body.error && body.error.message) || JSON.stringify(body)
    };
  }

  return { status: 'pending' };
}

async function saveImageFromUrl(imageUrl, batchId, index, seed) {
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
  return { dataUrl, fileName, savedPath };
}

/** 仅提交任务，秒级返回（适合 Vercel，避免 504） */
async function runSubmit(body) {
  assertApiConfigured();

  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    const err = new Error('请输入图片描述。');
    err.status = 400;
    throw err;
  }

  const count = normalizeCount(body.count);
  if (count > SUBMIT_CHUNK) {
    const err = new Error(`单次提交最多 ${SUBMIT_CHUNK} 张，请分批提交。`);
    err.status = 400;
    throw err;
  }

  const size = normalizeSize(body.size);
  const batchId =
    String(body.batchId || '').trim() ||
    new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const startId = Number.parseInt(body.startId, 10) || 1;

  const slots = Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    seed: randomSeed()
  }));

  const tasks = await runWithConcurrency(slots, SUBMIT_CONCURRENCY, async (slot) => {
    const taskId = await submitTask(prompt, size);
    return { id: slot.id, seed: slot.seed, size, taskId };
  });

  return {
    batchId,
    tasks,
    savedDir: IS_VERCEL ? null : OUTPUT_DIR,
    maxCount: MAX_COUNT,
    submitChunk: SUBMIT_CHUNK
  };
}

/** 单次查询任务状态，完成则下载图片（每次请求 < 15s） */
async function runPoll(body) {
  assertApiConfigured();

  const taskId = String(body.taskId || '').trim();
  const batchId = String(body.batchId || '').trim();
  const index = Number.parseInt(body.id, 10);
  const seed = body.seed;
  const size = normalizeSize(body.size);

  if (!taskId) {
    const err = new Error('缺少 taskId');
    err.status = 400;
    throw err;
  }

  const result = await queryTaskOnce(taskId);

  if (result.status === 'pending') {
    return { status: 'pending', taskId };
  }

  if (result.status === 'failed') {
    return { status: 'failed', taskId, message: result.message || '任务失败' };
  }

  const { dataUrl, fileName, savedPath } = await saveImageFromUrl(
    result.imageUrl,
    batchId || 'batch',
    index || 1,
    seed || 0
  );

  return {
    status: 'completed',
    taskId,
    image: { id: index, seed, size, taskId, dataUrl, fileName, savedPath }
  };
}

module.exports = {
  getHealthPayload,
  runSubmit,
  runPoll,
  MAX_COUNT
};
