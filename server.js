const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()

// 托管静态前端
app.use(cors())
app.use(express.json())
app.use(express.static(__dirname))

// 首页返回 index.html（必须加这行！）
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

// 你的绘图接口，保留不动
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body
    const apiKey = process.env.API_KEY
    const baseUrl = process.env.BASE_URL
    // 这里是你原来的接口逻辑
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`服务运行在 ${PORT}`)
})
