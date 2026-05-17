const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()

// 允许跨域、解析JSON
app.use(cors())
app.use(express.json())

// 托管静态文件（css、js、图片）
app.use(express.static(__dirname))

// 关键：所有GET请求都返回index.html，让前端自己处理路由
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

// 你的API接口，保持不变
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body
    const apiKey = process.env.API_KEY
    const baseUrl = process.env.BASE_URL
    // 你的原有接口逻辑写在这里
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`服务运行在 ${PORT}`)
})
