const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()

// 只允许跨域、解析JSON
app.use(cors())
app.use(express.json())

// 只处理 API 请求
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body
    const apiKey = process.env.API_KEY
    const baseUrl = process.env.BASE_URL
    // --- 这里放你原来的接口逻辑 ---
    res.json({ success: true, message: "接口正常" })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 静态文件和首页都不在这里处理了
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`API服务运行在 ${PORT}`)
})
