uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

curl -X POST http://192.168.31.76:8000/v1/chat/completions   -H "Content-Type: application/json"   -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "false"}],
    "stream": true
  }'