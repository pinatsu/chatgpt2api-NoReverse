import asyncio
import json
import uuid
import time
from typing import Dict, Optional, Any, AsyncGenerator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="ChatGPT2api MVP")

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局状态管理
class ConnectionManager:
    def __init__(self):
        self.active_connection: Optional[WebSocket] = None
        self.task_queues: Dict[str, asyncio.Queue] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        if self.active_connection:
            print("Warning: Replacing existing WebSocket connection.")
            try:
                await self.active_connection.close()
            except Exception:
                pass
        self.active_connection = websocket
        print("Browser script connected via WebSocket.")

    def disconnect(self, websocket: WebSocket):
        if self.active_connection == websocket:
            self.active_connection = None
            print("Browser script disconnected.")

    async def send_task(self, task_id: str, prompt: str):
        if not self.active_connection:
            raise HTTPException(status_code=503, detail="No browser script connected. Please open ChatGPT in your browser and ensure the Tampermonkey script is running.")
        
        command = {
            "action": "generate",
            "task_id": task_id,
            "prompt": prompt
        }
        await self.active_connection.send_text(json.dumps(command))
        print(f"Sent task {task_id} to browser.")

manager = ConnectionManager()

# 请求体模型
class ChatCompletionRequest(BaseModel):
    model: str = "gpt-4o"
    messages: list[Dict[str, str]]
    stream: bool = False

def create_sse_chunk(chunk_text: str, model: str, finish_reason: Optional[str] = None, is_first: bool = False) -> str:
    """构造 OpenAI 格式的流式数据块 (SSE)"""
    chunk_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
    created = int(time.time())
    
    delta = {"content": chunk_text} if not is_first else {"role": "assistant", "content": chunk_text}
    if finish_reason:
        delta = {} # 结束时 delta 为空
        
    data = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason
            }
        ]
    }
    return f"data: {json.dumps(data)}\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    # 获取最后一条用户消息作为 prompt (MVP 仅支持发送最后一句)
    if not request.messages:
        raise HTTPException(status_code=400, detail="Messages array cannot be empty")
    
    prompt = request.messages[-1].get("content", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="Last message must have content")

    task_id = f"task_{uuid.uuid4().hex}"
    queue = asyncio.Queue()
    manager.task_queues[task_id] = queue

    try:
        await manager.send_task(task_id, prompt)
    except Exception as e:
        del manager.task_queues[task_id]
        raise e

    if request.stream:
        async def event_generator() -> AsyncGenerator[str, None]:
            try:
                is_first = True
                while True:
                    # 等待来自 WebSocket 的文本块
                    chunk_text = await queue.get()
                    if chunk_text is None:
                        # 收到结束信号
                        yield create_sse_chunk("", request.model, finish_reason="stop")
                        yield "data: [DONE]\n\n"
                        break
                    
                    yield create_sse_chunk(chunk_text, request.model, is_first=is_first)
                    is_first = False
            finally:
                if task_id in manager.task_queues:
                    del manager.task_queues[task_id]
                    
        return StreamingResponse(event_generator(), media_type="text/event-stream")
    
    else:
        # 非流式：收集所有块后一次性返回
        full_text = ""
        while True:
            chunk_text = await queue.get()
            if chunk_text is None:
                break
            full_text += chunk_text
            
        if task_id in manager.task_queues:
            del manager.task_queues[task_id]

        response_data = {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": full_text
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0
            }
        }
        return response_data


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
                action = data.get("action")
                task_id = data.get("task_id")
                
                if not task_id or task_id not in manager.task_queues:
                    # 如果找不到对应的 queue，可能任务已经被取消或过期
                    continue
                    
                queue = manager.task_queues[task_id]
                
                if action == "chunk":
                    content = data.get("content", "")
                    if content:
                        await queue.put(content)
                elif action == "done":
                    # 发送 None 标志结束
                    await queue.put(None)
                elif action == "error":
                    # 可以在这里处理错误，MVP 中暂简单结束
                    await queue.put(None)
                    
            except json.JSONDecodeError:
                print(f"Received invalid JSON from browser: {data_text}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
