/**
 * panel.js — Side Panel Chat & Automation Interface
 *
 * Full conversation UI with model routing, page context injection,
 * and manual/auto mode switching.
 */

// ─── DOM References ──────────────────────────────────────────────────────

const providerSelect = document.getElementById('provider-select');
const taskTypeSelect = document.getElementById('task-type-select');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const messagesEl = document.getElementById('messages');
const routeIndicator = document.getElementById('route-indicator');
const modelCostDisplay = document.getElementById('model-cost-display');
const injectPageCb = document.getElementById('inject-page-cb');
const panelStatusDot = document.getElementById('panel-status-dot');
const chatArea = document.getElementById('chat-area');

// ─── State ───────────────────────────────────────────────────────────────

let conversationHistory = [];
let routerInfo = null;
let activeTaskId = 0;
let providerKeys = [];

// ─── Init ────────────────────────────────────────────────────────────────

let showAllModels = false; // toggle for advanced users

async function init() {
  console.log('[AI Browse Panel] init start');
  try {
    // Check if user has configured any keys
    const { setupDone } = await chrome.runtime.sendMessage({ type: 'GET_SETUP_STATUS' });
    console.log('[AI Browse Panel] GET_SETUP_STATUS:', setupDone);
    const keyStatus = await chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' });
    console.log('[AI Browse Panel] GET_KEY_STATUS:', keyStatus);
    const configuredProviders = Object.entries(keyStatus || {})
      .filter(([_, configured]) => configured)
      .map(([key]) => key);

    if (!setupDone || configuredProviders.length === 0) {
      showSetupBanner();
      return;
    }

    await loadRouterInfo();
    await loadModelCatalog();

    // Events
    providerSelect.addEventListener('change', onProviderChange);
    sendBtn.addEventListener('click', onSend);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    });

    // Request page context from content script
    requestPageContext();
  } catch (err) {
    console.error('[AI Browse Panel] init failed:', err);
    messagesEl.innerHTML = `
      <div class="msg msg-error" style="padding:16px; color:#f85149;">
        <strong>AI Browse panel failed to initialize.</strong><br>
        ${err.message || err}<br><br>
        Check chrome://extensions for errors and reload the extension.
      </div>
    `;
  }
}

async function loadModelCatalog() {
  // Try to get cached catalog first
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CATALOG' });
  if (resp.ok && resp.recommended && resp.recommended.length > 0) {
    await populateProviderSelectFromCatalog(resp.recommended, resp.catalog);
  } else {
    // Fallback to discovery
    const discover = await chrome.runtime.sendMessage({ type: 'DISCOVER_MODELS' });
    if (discover.ok && discover.recommended) {
      await populateProviderSelectFromCatalog(discover.recommended, discover.catalog);
    } else {
      // Ultimate fallback: static list
      populateProviderSelect([]);
    }
  }
}

function showSetupBanner() {
  messagesEl.innerHTML = `
    <div class="msg msg-system" style="text-align:center; padding: 40px 20px;">
      <div style="font-size: 32px; margin-bottom: 12px;">🔑</div>
      <h2 style="color: #f0f6fc; margin: 0 0 8px;">API Keys Required</h2>
      <p style="color: #8b949e; margin: 0 0 20px; line-height: 1.5;">
        AI Browse needs at least one API key to chat with AI models.<br>
        OpenRouter is recommended — one key gives you access to 200+ models.
      </p>
      <button id="setup-btn" style="
        background: #238636;
        color: #fff;
        border: none;
        padding: 10px 24px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
      ">Configure API Keys →</button>
    </div>
  `;
  document.getElementById('setup-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding.html') });
  });
  providerSelect.innerHTML = '<option value="auto">Auto (routed)</option>';
  promptInput.disabled = true;
  sendBtn.disabled = true;
}

async function loadRouterInfo() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_ROUTER_INFO' });
  routerInfo = resp;
  providerKeys = Object.keys((routerInfo && routerInfo.models) || {});
  updateStatusDot();
}

async function populateProviderSelectFromCatalog(recommended, catalog) {
  providerSelect.innerHTML = '<option value="auto">Auto (routed)</option>';

  let models = recommended || [];
  if (showAllModels) {
    try {
      const all = await chrome.runtime.sendMessage({ type: 'GET_ALL_MODELS' });
      models = all.ok ? all.models : recommended;
    } catch (e) {
      console.warn('[AI Browse Panel] Failed to load all models for toggle:', e);
      models = recommended || [];
    }
  }

  for (const model of models) {
    const opt = document.createElement('option');
    // value format: provider:modelId for unique identification
    opt.value = `${model.provider}:${model.id}`;
    const tierIcon = model.tier === 'recommended' ? '⭐' : model.tier === 'capable' ? '✓' : '○';
    const context = model.contextLength ? `(${model.contextLength >= 1000 ? (model.contextLength/1000).toFixed(0) + 'k' : model.contextLength} ctx)` : '';
    opt.textContent = `${tierIcon} ${model.name} ${context}`;
    providerSelect.appendChild(opt);
  }

  // Add toggle option at bottom
  const toggleOpt = document.createElement('option');
  toggleOpt.disabled = true;
  toggleOpt.textContent = showAllModels ? '— Hide advanced models —' : '— Show all models —';
  providerSelect.appendChild(toggleOpt);
}

function populateProviderSelect(configuredProviders = null) {
  providerSelect.innerHTML = '<option value="auto">Auto (routed)</option>';
  const keys = configuredProviders || providerKeys;
  for (const key of keys) {
    const meta = (routerInfo && routerInfo.models) ? routerInfo.models[key] : null;
    const opt = document.createElement('option');
    opt.value = key;
    if (meta) {
      const stars = '★'.repeat(meta.browseSuitability || 0) + '☆'.repeat(5 - (meta.browseSuitability || 0));
      opt.textContent = `${meta.displayName} — $${meta.costPer1KTokens.toFixed(5)}/1k ${stars}`;
    } else {
      opt.textContent = key;
    }
    providerSelect.appendChild(opt);
  }
}

function updateStatusDot() {
  if (routerInfo?.mode?.active) {
    panelStatusDot.className = 'dot dot-green';
  } else {
    panelStatusDot.className = 'dot dot-yellow';
  }
}

// ─── Provider Change ─────────────────────────────────────────────────────

async function onProviderChange() {
  const selected = providerSelect.value;
  if (selected === 'auto') {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'auto' });
  } else {
    await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      mode: 'manual',
      modelKey: selected,
    });
    const meta = (routerInfo && routerInfo.models) ? routerInfo.models[selected] : null;
    if (meta) {
      modelCostDisplay.textContent = `${meta.displayName} — $${meta.costPer1KTokens.toFixed(5)}/1k`;
    } else {
      modelCostDisplay.textContent = selected;
    }
  }
  await loadRouterInfo();
}

// ─── Page Context Injection ──────────────────────────────────────────────

async function requestPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' }).catch(() => null);
    if (resp) {
      window._pageContext = resp;
    }
  } catch {
    // content script may not be loaded on this page
    window._pageContext = null;
  }
}

// ─── Send Message ────────────────────────────────────────────────────────

async function onSend() {
  const text = promptInput.value.trim();
  if (!text) return;

  promptInput.value = '';
  scrollToBottom();

  const taskType = taskTypeSelect.value;
  const provider = providerSelect.value === 'auto' ? null : providerSelect.value;

  // Build messages array
  const systemMsg = buildSystemPrompt(taskType, injectPageCb.checked);
  const userMessages = [
    { role: 'system', content: systemMsg },
    ...conversationHistory.slice(-20), // keep context manageable
    { role: 'user', content: text },
  ];

  // Show user message
  addMessage('user', text);
  const msgEl = addMessage('model', 'Thinking...', true);

  // Route and call
  const resp = await chrome.runtime.sendMessage({
    type: 'CHAT_COMPLETION',
    provider,
    messages: userMessages,
    options: {
      taskType,
      max_tokens: taskType === 'extract' ? 1024 : 4096,
      contextSize: estimateTokens(systemMsg),
    },
  });

  if (resp.ok) {
    const reply = resp.data.choices[0].message.content;
    msgEl.querySelector('.msg-content').textContent = reply;
    msgEl.classList.remove('msg-loading');

    // Show route info
    showRouteIndicator(resp.model, taskType);

    // Update conversation
    conversationHistory.push({ role: 'user', content: text });
    conversationHistory.push({ role: 'assistant', content: reply });

    // Update active model
    await loadRouterInfo();
  } else {
    msgEl.querySelector('.msg-content').textContent = `Error: ${resp.error}`;
    msgEl.classList.add('msg-error');
    msgEl.classList.remove('msg-loading');
  }
}

// ─── System Prompt Builder ───────────────────────────────────────────────

function buildSystemPrompt(taskType, includePageContext) {
  const parts = [
    'You are AI Browse, a browser-automation agent. Be direct and action-oriented.',
    'Do not narrate future actions. Produce the next concrete browser step, code change, or routing decision.',
    'When uncertain, inspect the page or extension codebase before guessing.',
    'Preserve spend by pushing routine extraction and transformation work down to cheaper models.',
  ];

  if (taskType === 'browse') {
    parts.push('You are handling browser automation: DOM reading, page-state reasoning, multi-step execution.');
    parts.push('Use DeepSeek V4-Flash by default. Only escalate to stronger models on repeated failure.');
  } else if (taskType === 'reason') {
    parts.push('This is a complex reasoning task requiring strong planning and large-context understanding.');
    parts.push('Prioritize Kimi K2.6 or Grok Build. Take your time to reason step by step.');
  } else if (taskType === 'code') {
    parts.push('This is a code-agent task: generate or repair selectors, wrappers, orchestration logic, or automation code.');
    parts.push('Prefer Grok Build for code generation. Write clean, tested code.');
  } else if (taskType === 'extract') {
    parts.push('This is a fast extraction/classification subtask. Be fast and cheap.');
    parts.push('Summarize, extract, normalize, or transform the data into strict structure. Use Groq Llama 3 if possible.');
  } else if (taskType === 'scrap') {
    parts.push('This is a low-cost coding/scraping backup task. Keep it simple and cheap.');
    parts.push('Use Qwen3 Coder if available. Do not over-engineer.');
  }

  if (includePageContext && window._pageContext) {
    parts.push(`\nCurrent page context:\nURL: ${window._pageContext.url}\nTitle: ${window._pageContext.title}\nDOM Summary: ${window._pageContext.domSummary || '(not available)'}`);
    if (window._pageContext.selectedText) {
      parts.push(`Selected text: "${window._pageContext.selectedText}"`);
    }
  }

  return parts.join('\n');
}

// ─── UI Helpers ──────────────────────────────────────────────────────────

function addMessage(role, content, isLoading = false) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  if (isLoading) div.classList.add('msg-loading');
  div.innerHTML = `<div class="msg-label">${role === 'user' ? 'You' : 'AI'}</div><div class="msg-content">${content}</div>`;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function showRouteIndicator(modelName, taskType) {
  routeIndicator.classList.remove('hidden');
  routeIndicator.textContent = `Routed: ${modelName} (${taskType})`;
  setTimeout(() => routeIndicator.classList.add('hidden'), 5000);
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ─── Boot ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

// Refresh router info periodically
setInterval(loadRouterInfo, 10000);