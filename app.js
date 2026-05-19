// 本地 Express 入口（Vercel 使用 api/generate.js、api/health.js）

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getHealthPayload, runGenerate } = require('./lib/generate');

const PUBLIC_DIR = path.join(__dirname, 'public');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', dotfiles: 'deny' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json(getHealthPayload());
});

app.post('/api/generate', async (req, res) => {
  try {
    const data = await runGenerate(req.body);
    res.json(data);
  } catch (err) {
    console.error('生成失败：', err);
    res.status(err.status || 500).json({ message: err.message || '生成失败' });
  }
});

module.exports = app;
