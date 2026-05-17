const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const app = express();

app.use(cors());
app.use(express.json());

// 静态资源全部托管
app.use(express.static(path.join(__dirname)));

// 只拦截接口，其余全给前端
app.use('/api', (req,res,next)=>{
  next();
});

// 所有页面请求全部返回首页，不跳转、不刷新
app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname,'index.html'));
});

// 你的生成接口原样放这里
app.post('/api/generate', async (req,res)=>{

});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>{
  console.log('run');
});
