// ==UserScript==
// @name         ChatGPT2api MVP
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Connect ChatGPT to a local Python API via WebSocket
// @author       You
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
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

    let pollInterval = null;
    let idleTimeout = null;

    function startListeningForReply(taskId) {
        if (pollInterval) clearInterval(pollInterval);
        lastProcessedText = "";

        // Broadest possible selector to find the assistant's message container or text block
        const getCandidates = () => Array.from(document.querySelectorAll('.markdown, .prose, [data-message-author-role="assistant"]'));

        let initialLastNode = getCandidates().pop();
        let initialText = initialLastNode ? initialLastNode.textContent : "";

        let waitAttempts = 0;
        let checkInterval = setInterval(() => {
            waitAttempts++;

            const stopBtn = document.querySelector('button[aria-label*="Stop" i], button[aria-label*="停止" i], button[data-testid*="stop" i], #composer-submit-button.composer-secondary-button-color');

            const currentCandidates = getCandidates();
            const currentLastNode = currentCandidates.pop();
            const currentText = currentLastNode ? currentLastNode.textContent : "";

            // Generation has started if: a new message node appears, the text of the last node changes, or the stop button appears.
            const isNewNode = currentLastNode && currentLastNode !== initialLastNode;
            const textChanged = currentLastNode && currentLastNode === initialLastNode && currentText !== initialText;

            if (stopBtn || isNewNode || textChanged) {
                clearInterval(checkInterval);
                startPolling(taskId);
            } else if (waitAttempts > 60) { // 30 seconds
                clearInterval(checkInterval);
                console.error('[ChatGPT2api] Timeout waiting for assistant reply bubble to appear.');
                sendError(taskId, "Timeout waiting for assistant reply bubble to appear.");
                finishTask(taskId);
            }
        }, 500);
    }

    function startPolling(taskId) {
        console.log('[ChatGPT2api] Started polling reply...');

        pollInterval = setInterval(() => {
            const candidates = document.querySelectorAll('.markdown, .prose, [data-message-author-role="assistant"]');
            if (candidates.length === 0) return;

            // Always read the last assistant message on the page
            const targetNode = candidates[candidates.length - 1];
            // Extract text from .markdown if it exists inside the bubble, otherwise fallback to the whole bubble
            const mdNode = targetNode.querySelector('.markdown, .prose');
            let fullText = (mdNode ? mdNode.textContent : targetNode.textContent) || "";
            
            // Remove trailing whitespaces/newlines. This prevents temporary HTML formatting
            // or cursor elements from causing duplicated newlines like "childre\n\nn".
            // Legitimate newlines will be preserved once non-whitespace characters follow them.
            fullText = fullText.replace(/[\s\u200B-\u200D\uFEFF]+$/, '');

            if (fullText.length > lastProcessedText.length && fullText.startsWith(lastProcessedText)) {
                const chunk = fullText.substring(lastProcessedText.length);
                lastProcessedText = fullText;

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        action: 'chunk',
                        task_id: taskId,
                        content: chunk
                    }));
                }
            } else if (fullText.length > 0 && !fullText.startsWith(lastProcessedText)) {
                let i = 0;
                while (i < fullText.length && i < lastProcessedText.length && fullText[i] === lastProcessedText[i]) {
                    i++;
                }
                const chunk = fullText.substring(i);
                if (chunk.length > 0) {
                    lastProcessedText = fullText.substring(0, i) + chunk;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            action: 'chunk',
                            task_id: taskId,
                            content: chunk
                        }));
                    }
                }
            }

            // Check if generation is done (stop button disappeared)
            const stopBtnSelector = 'button[aria-label*="Stop" i], button[aria-label*="停止" i], button[data-testid*="stop" i], #composer-submit-button.composer-secondary-button-color';
            const stopBtn = document.querySelector(stopBtnSelector);

            if (!stopBtn && fullText.length > 0) {
                if (!idleTimeout) {
                    idleTimeout = setTimeout(() => {
                        // Double check after 1 second
                        const checkStopBtn = document.querySelector(stopBtnSelector);
                        if (!checkStopBtn) {
                            finishTask(taskId);
                        } else {
                            idleTimeout = null;
                        }
                    }, 1000);
                }
            } else if (stopBtn) {
                if (idleTimeout) {
                    clearTimeout(idleTimeout);
                    idleTimeout = null;
                }
            }
        }, 100);
    }

    function handleGenerate(taskId, prompt) {
        currentTask = taskId;

        if (!simulateInput(prompt)) {
            sendError(taskId, "Failed to input prompt");
            return;
        }

        setTimeout(() => {
            if (!clickSendButton()) {
                sendError(taskId, "Failed to click send button");
                return;
            }
            startListeningForReply(taskId);
        }, 500);
    }

    function finishTask(taskId) {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        if (idleTimeout) {
            clearTimeout(idleTimeout);
            idleTimeout = null;
        }
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
