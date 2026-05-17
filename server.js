const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()

// 托管所有静态文件，index.html 和 batch.html 都会被当成独立页面
app.use(cors())
app.use(express.json())
app.use(express.static(__dirname))

// 你的API接口，原样保留
app.post('/api/generate', async (req, res) => {
  // 你原来的接口代码，保持不变
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('本地服务正常运行')
})
