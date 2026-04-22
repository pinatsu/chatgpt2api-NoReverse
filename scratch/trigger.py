import time
import urllib.request
import json
import traceback

print("Trigger script started. Waiting 15 seconds before sending request...")
time.sleep(15)

try:
    print("Sending POST request to http://127.0.0.1:8000/v1/chat/completions...")
    req = urllib.request.Request(
        "http://127.0.0.1:8000/v1/chat/completions",
        data=json.dumps({
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "Explain 1+1 briefly."}],
            "stream": True
        }).encode('utf-8'),
        headers={"Content-Type": "application/json"}
    )
    
    with urllib.request.urlopen(req) as response:
        print("Response opened. Reading stream...")
        for line in response:
            if line:
                print(line.decode('utf-8').strip())
except Exception as e:
    print(f"Error sending request: {e}")
    traceback.print_exc()

print("Trigger script finished.")
