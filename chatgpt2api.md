# ChatGPT2api 项目实施计划

## 1. 目标与定位 (Objective)
使用 Python (服务端) 和 Tampermonkey 油猴脚本 (浏览器端) 构建一个最简可行原型 (MVP)，将 ChatGPT 网页版封装成本地可调用的、兼容 OpenAI 规范的 API (`/v1/chat/completions`)。
**定位**: MVP 阶段聚焦“单标签页、单会话、手动保持网页打开”的可用性，后续再演进为全自动化、多会话的高可靠版本。

## 2. 系统架构 (Architecture)
### 2.1 服务端 (Server - Python)
*   **技术栈**: `FastAPI` + `uvicorn` (提供高性能异步 REST API) + `websockets` (或 FastAPI 内置的 WebSocket 功能)
*   **核心功能**:
    1.  暴露标准 `POST /v1/chat/completions` 接口（MVP 阶段暂仅支持单轮对话 `messages` 数组的最后一条）。
    2.  启动并维护 WebSocket 服务（默认端口如 `8765`），等待浏览器脚本主动连接。
    3.  收到 API 请求时，通过 WebSocket 将“用户提示词(prompt)”下发给脚本。
    4.  接收脚本回传的“流式文本块 (chunk)”和“完成状态 (done)”，并将其转化为 Server-Sent Events (SSE) 格式，流式返回给调用方应用。

### 2.2 浏览器端 (Client - Tampermonkey 脚本)
*   **技术栈**: 原生 JavaScript 注入页面。
*   **目标网址**: `https://chatgpt.com/*` (用户需手动打开此页面并保持在前台/激活状态)。
*   **核心功能**:
    1.  建立到本地服务端的 WebSocket 连接 (`ws://localhost:8765`)，并实现自动重连。
    2.  监听服务端指令（如：`type="prompt", content="Hello"`）。
    3.  收到指令后，执行 DOM 交互：
        *   查找输入框 (`ProseMirror` 或 `#prompt-textarea`)。
        *   模拟输入文本。
        *   查找并点击“发送按钮”。
    4.  回复监听 (MutationObserver)：
        *   定位最新的回复气泡容器。
        *   监听容器内容的增量变化。
        *   将新增的文本块 (`chunk`) 实时发送回本地服务端。
        *   检测回复是否完成（例如：停止按钮消失，或出现复制按钮），发送完成信号 (`done`)。

## 3. 通信协议设计 (WebSocket Protocol Draft)

### Server -> Client (下发任务)
```json
{
  "action": "generate",
  "task_id": "req-12345",
  "prompt": "你好，请解释相对论。"
}
```

### Client -> Server (回传流数据)
```json
// 增量返回
{
  "action": "chunk",
  "task_id": "req-12345",
  "content": "相对论"
}

// 结束返回
{
  "action": "done",
  "task_id": "req-12345"
}
```

## 4. 实施阶段与步骤 (Implementation Steps)

### Phase 1: Python 服务端基础搭建
1.  在 `d:\project\ChatGPT2api\` 目录下创建 `server` 文件夹。
2.  配置 `requirements.txt` (包含 `fastapi`, `uvicorn`, `websockets`)。
3.  编写 `main.py`：
    *   实现 WebSocket 路由，管理单一活跃连接（脚本端连接）。
    *   实现 `/v1/chat/completions` HTTP 路由（暂用模拟流数据测试，不连前端）。

### Phase 2: Tampermonkey 脚本编写与基础 DOM 测试
1.  编写 `chatgpt2api.user.js`。
2.  实现 WebSocket 基础连接与重连逻辑。
3.  **核心难点攻坚**：编写可靠的 DOM 选择器和模拟输入函数。因为 ChatGPT 前端采用 ProseMirror 这样的富文本编辑器，不能简单赋值 `value`，通常需要派发底层的 `InputEvent` 和 `KeyboardEvent`，或者操作 React 内部状态（MVP 尽量避免）。

### Phase 3: 全链路联调与回复监听
1.  将服务端的 HTTP 请求数据真正通过 WS 下发给脚本。
2.  在脚本中实现 `MutationObserver`，提取 Markdown 或纯文本内容的增量变化。
3.  服务端接收并将其包装为 OpenAI 标准流式响应，返回给客户端工具（如 Chatbox）。

## 5. MVP 阶段的限制 (MVP Limitations)
1.  **单并发**: 同一时间只能处理一个 API 请求，如果上一个请求还在生成，新的请求需要排队或直接拒绝。
2.  **页面状态依赖**: 需要人为保证浏览器已登录 ChatGPT 账号，并在主聊天页面处于就绪状态。
3.  **会话连续性**: MVP 阶段主要针对单轮问答（或者说依赖网页版当前的会话上下文），不支持 API 级别携带完整历史记录（API 传入的历史消息可能会被截断为只发最后一句）。

## 6. 后续演进路线 (Future Roadmap)
*   支持通过 API 指定跳转历史会话（需要解决页面刷新断连问题）。
*   将脚本升级为完整的 Chrome Extension 扩展。
*   支持更健壮的输入模拟和富文本解析。