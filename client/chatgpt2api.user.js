// ==UserScript==
// @name         ChatGPT2api MVP
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Connect ChatGPT to a local Python API via WebSocket
// @author       You
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const WS_URL = 'ws://localhost:8000/ws';
    let ws = null;
    let currentTask = null;
    let observer = null;
    let lastProcessedText = "";

    function connect() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('[ChatGPT2api] Connected to local server.');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.action === 'generate') {
                    console.log('[ChatGPT2api] Received task:', data);
                    handleGenerate(data.task_id, data.prompt);
                }
            } catch (e) {
                console.error('[ChatGPT2api] Error parsing message:', e);
            }
        };

        ws.onclose = () => {
            console.log('[ChatGPT2api] Disconnected. Reconnecting in 3s...');
            setTimeout(connect, 3000);
        };

        ws.onerror = (err) => {
            console.error('[ChatGPT2api] WebSocket error:', err);
        };
    }

    // --- DOM Interaction ---
    
    function simulateInput(prompt) {
        // Find the input element. ChatGPT currently uses a ProseMirror editable div.
        const inputDiv = document.querySelector('#prompt-textarea');
        if (!inputDiv) {
            console.error('[ChatGPT2api] Input box not found.');
            return false;
        }

        // ChatGPT's React app ignores simple textContent assignment.
        // The most reliable way is often to focus it and trigger an paste or input event 
        // that looks genuine.
        inputDiv.focus();
        
        // Clear existing
        inputDiv.innerHTML = `<p>${prompt.replace(/\n/g, '<br>')}</p>`;
        
        // Dispatch an input event so React state updates
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        inputDiv.dispatchEvent(inputEvent);
        
        return true;
    }

    function clickSendButton() {
        // Try to find the send button. Usually has data-testid="send-button"
        const sendBtn = document.querySelector('button[data-testid="send-button"]');
        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return true;
        }
        return false;
    }

    function startListeningForReply(taskId) {
        if (observer) {
            observer.disconnect();
        }
        lastProcessedText = "";

        // Wait a moment for the new assistant bubble to appear in the DOM
        setTimeout(() => {
            // Find all assistant messages
            const messages = document.querySelectorAll('div[data-message-author-role="assistant"]');
            if (messages.length === 0) {
                console.error('[ChatGPT2api] No assistant message found to observe.');
                sendError(taskId, "Could not find assistant message element.");
                return;
            }
            
            // The last one is the current reply
            const targetNode = messages[messages.length - 1];

            // Setup MutationObserver to watch for text additions
            observer = new MutationObserver((mutationsList, obs) => {
                const fullText = targetNode.textContent;
                
                // Calculate the incremental chunk
                if (fullText.length > lastProcessedText.length && fullText.startsWith(lastProcessedText)) {
                    const chunk = fullText.substring(lastProcessedText.length);
                    lastProcessedText = fullText;
                    
                    // Send chunk to server
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            action: 'chunk',
                            task_id: taskId,
                            content: chunk
                        }));
                    }
                }

                // Check if generation is done (simplified approach: look for the stop button vs regenerate button)
                // If there's a button with data-testid="stop-button", it's generating.
                // If it's gone and we see say "copy" or similar, or it's just stable.
                const stopBtn = document.querySelector('button[data-testid="stop-button"]');
                if (!stopBtn && fullText.length > 0) {
                    // It might be done. Wait a tiny bit to be sure no more DOM updates are coming
                    setTimeout(() => {
                        const checkStopBtn = document.querySelector('button[data-testid="stop-button"]');
                        if (!checkStopBtn) {
                            finishTask(taskId);
                        }
                    }, 500);
                }
            });

            observer.observe(targetNode, { characterData: true, childList: true, subtree: true });
            console.log('[ChatGPT2api] Started observing reply...');
        }, 1000); // 1s delay to let the UI create the bubble
    }

    function handleGenerate(taskId, prompt) {
        currentTask = taskId;
        
        if (!simulateInput(prompt)) {
            sendError(taskId, "Failed to input prompt");
            return;
        }

        // Give React a moment to update the send button state based on the input
        setTimeout(() => {
            if (!clickSendButton()) {
                sendError(taskId, "Failed to click send button");
                return;
            }
            startListeningForReply(taskId);
        }, 100);
    }

    function finishTask(taskId) {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'done',
                task_id: taskId
            }));
            console.log(`[ChatGPT2api] Task ${taskId} finished.`);
        }
        currentTask = null;
    }

    function sendError(taskId, errorMsg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'error',
                task_id: taskId,
                error: errorMsg
            }));
        }
    }

    // Start connection
    connect();

})();
