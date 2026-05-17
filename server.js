// 本地开发启动：node server.js 或 npm start

require('dotenv').config();

const app = require('./app');

const API_BASE_URL = String(process.env.API_BASE_URL || '').trim();
const API_KEY = String(process.env.API_KEY || '').trim();

if (!API_BASE_URL || !API_KEY) {
  console.error(
    '缺少环境变量：请在项目根目录创建 .env，配置 API_BASE_URL 与 API_KEY（可参考 .env.example）。'
  );
  process.exit(1);
}

const PORT = Number.parseInt(process.env.PORT || '8888', 10) || 8888;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI 批量文生图服务已启动：http://0.0.0.0:${PORT}`);
  console.log(`首页：http://0.0.0.0:${PORT}/`);
  console.log(`批量页：http://0.0.0.0:${PORT}/batch.html`);
});
