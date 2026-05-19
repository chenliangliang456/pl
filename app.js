// Express 入口：本地 / Render 用 server.js 启动；Vercel 另用 api/*.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getHealthPayload, runSubmit, runPoll } = require('./lib/generate');

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
    const data = await runSubmit(req.body);
    res.json(data);
  } catch (err) {
    console.error('提交失败：', err);
    res.status(err.status || 500).json({ message: err.message || '提交失败' });
  }
});

app.post('/api/poll', async (req, res) => {
  try {
    const data = await runPoll(req.body);
    res.json(data);
  } catch (err) {
    console.error('轮询失败：', err);
    res.status(err.status || 500).json({ message: err.message || '轮询失败' });
  }
});

module.exports = app;
