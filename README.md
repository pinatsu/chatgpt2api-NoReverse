uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

安装浏览器插件允许跨域
https://chromewebstore.google.com/detail/hnojoemndpdjofcdaonbefcfecpjfflh

curl -X POST http://192.168.31.76:8000/v1/chat/completions   -H "Content-Type: application/json"   -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "false"}],
    "stream": true
  }'