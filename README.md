# ChatGPT2api

将网页版 ChatGPT 封装为本地标准 OpenAI API 格式的轻量级工具。

本项目通过油猴脚本（Tampermonkey）接管网页版 ChatGPT，配合本地 Python 服务端，实现完全兼容 OpenAI `v1/chat/completions` 接口的数据流式转发。支持各种原生 AI 客户端（如 Chatbox, NextChat 等）无缝接入。

## 🌟 核心特性

- **完全免费**：直接使用 ChatGPT 网页版算力，无需官方 API Key。
- **无缝接入**：提供标准 OpenAI 兼容的 REST API 接口，支持 Streaming 流式打字机输出。
- **强鲁棒性**：基于 DOM 状态突变与原生键盘事件注入，完美绕过 React 重新渲染魔法。

## ⚙️ 架构说明

本项目由两部分组成：
1. **服务端 (`server/main.py`)**：基于 FastAPI。接收标准 API 请求，通过 WebSocket 将指令转发给浏览器，并将浏览器传回的增量文本组装为标准的 Server-Sent Events (SSE) 返回给 API 调用方。
2. **客户端 (`client/chatgpt2api.user.js`)**：Tampermonkey 油猴脚本。注入到 ChatGPT 网页，负责与服务端建立 WebSocket 连接，接收提示词并模拟真实人工输入与点击，监控并提取回复气泡内容实时传回。

## 🚀 快速开始

### 1. 启动本地服务端

服务端位于 `server` 目录，推荐使用 `uv` 进行依赖管理。

```bash
cd server
# 启动服务 (默认运行在 8000 端口)
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
*(如果缺失依赖，请先执行 `uv pip install fastapi uvicorn pydantic`)*

### 2. 配置浏览器客户端

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. 将 `client/chatgpt2api.user.js` 的内容添加为一个新的油猴脚本并启用。
3. **【重要】解决跨域限制**：由于网页 CSP 限制，需安装浏览器插件以允许 WebSocket 连接到本地：
   - 推荐插件：[Allow CORS: Access-Control-Allow-Origin](https://chromewebstore.google.com/detail/hnojoemndpdjofcdaonbefcfecpjfflh)
   - 确保该插件已在 ChatGPT 网页启用。
4. 在浏览器中打开 [ChatGPT 官网](https://chatgpt.com/) 并登录你的账号。
5. 按 `F12` 打开控制台，确认看到 `[ChatGPT2api] Connected to local server.` 提示，代表连接成功。

### 3. 测试调用

打开终端，使用标准 OpenAI API 格式发送请求：

```bash
curl -X POST http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好，请自我介绍一下。"}],
    "stream": true
  }'
```

**在第三方客户端（如 Chatbox）配置：**
- **API URL**：`http://127.0.0.1:8000/v1`
- **API Key**：随意填写（本地服务端未做校验，例如：`sk-123456`）
- **模型**：`gpt-4o`

## ⚠️ 已知问题与 TODO

- [ ] **后台休眠卡顿**：浏览器不在前端时，API 会卡住（由于现代浏览器会限制后台标签页的定时器执行频率）。建议将 ChatGPT 标签页作为独立窗口放置在屏幕边缘保持激活。
- [ ] **异常换行符**：返回结果文本中可能会包含多余的莫名其妙的换行符，后续需优化文本提取机制。
- [ ] **并发限制**：MVP 阶段仅支持单并发发送逻辑，暂未完全处理多并发请求的排队机制。