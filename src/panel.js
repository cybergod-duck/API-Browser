/**
 * panel.js — Side Panel with Live Model Catalog
 */

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

let conversationHistory = [];
let routerInfo = null;
let showAllModels = false;

async function init() {
  const { setupDone } = await chrome.runtime.sendMessage({ type: 'GET_SETUP_STATUS' });
  const keyStatus = await chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' });
  const configuredProviders = Object.entries(keyStatus || {}).filter(([_, c]) => c).map(([k]) => k);

  if (!setupDone || configuredProviders.length === 0) {
    showSetupBanner();
    return;
  }

  await loadRouterInfo();
  await loadModelCatalog();

  providerSelect.addEventListener('change', onProviderChange);
  sendBtn.addEventListener('click', onSend);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  });
  requestPageContext();
}

async function loadModelCatalog() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CATALOG' });
  if (resp.ok && resp.recommended?.length > 0) {
    populateProviderSelectFromCatalog(resp.recommended);
  } else {
    const discover = await chrome.runtime.sendMessage({ type: 'DISCOVER_MODELS' });
    if (discover.ok && discover.recommended) {
      populateProviderSelectFromCatalog(discover.recommended);
    } else {
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
      <button id="setup-btn" style="background: #238636; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;">Configure API Keys →</button>
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
  routerInfo = await chrome.runtime.sendMessage({ type: 'GET_ROUTER_INFO' });
  updateStatusDot();
}

function populateProviderSelectFromCatalog(recommended) {
  providerSelect.innerHTML = '<option value="auto">Auto (routed)</option>';
  const models = showAllModels ? [] : recommended; // placeholder for async all-models

  for (const model of models) {
    const opt = document.createElement('option');
    opt.value = `${model.provider}:${model.id}`;
    const icon = model.tier === 'recommended' ? '⭐' : model.tier === 'capable' ? '✓' : '○';
    const ctx = model.contextLength ? `(${(model.contextLength/1000).toFixed(0)}k ctx)` : '';
    opt.textContent = `${icon} ${model.name} ${ctx}`;
    providerSelect.appendChild(opt);
  }

  const toggle = document.createElement('option');
  toggle.disabled = true;
  toggle.textContent = showAllModels ? '— Hide advanced models —' : '— Show all models —';
  providerSelect.appendChild(toggle);
}

function populateProviderSelect(configuredProviders) {
  providerSelect.innerHTML = '<option value="auto">Auto (routed)</option>';
  for (const key of configuredProviders || []) {
    const meta = routerInfo?.models?.[key];
    if (!meta) continue;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${meta.displayName} — $${meta.costPer1KTokens.toFixed(5)}/1k`;
    providerSelect.appendChild(opt);
  }
}

function updateStatusDot() {
  panelStatusDot.className = routerInfo?.mode?.active ? 'dot dot-green' : 'dot dot-yellow';
}

async function onProviderChange() {
  const selected = providerSelect.value;
  if (selected === 'auto') {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'auto' });
  } else {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'manual', modelKey: selected });
  }
  await loadRouterInfo();
}

async function requestPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' }).catch(() => null);
      if (resp) window._pageContext = resp;
    }
  } catch { window._pageContext = null; }
}

async function onSend() {
  const text = promptInput.value.trim();
  if (!text) return;
  promptInput.value = '';

  const taskType = taskTypeSelect.value;
  const provider = providerSelect.value === 'auto' ? null : providerSelect.value;
  const systemMsg = buildSystemPrompt(taskType, injectPageCb.checked);
  const userMessages = [
    { role: 'system', content: systemMsg },
    ...conversationHistory.slice(-20),
    { role: 'user', content: text },
  ];

  addMessage('user', text);
  const msgEl = addMessage('model', 'Thinking...', true);

  const resp = await chrome.runtime.sendMessage({
    type: 'CHAT_COMPLETION',
    provider,
    messages: userMessages,
    options: { taskType, max_tokens: taskType === 'extract' ? 1024 : 4096, contextSize: estimateTokens(systemMsg) },
  });

  if (resp.ok) {
    const reply = resp.data.choices[0].message.content;
    msgEl.querySelector('.msg-content').textContent = reply;
    msgEl.classList.remove('msg-loading');
    showRouteIndicator(resp.model, taskType);
    conversationHistory.push({ role: 'user', content: text });
    conversationHistory.push({ role: 'assistant', content: reply });
    await loadRouterInfo();
  } else {
    msgEl.querySelector('.msg-content').textContent = `Error: ${resp.error}`;
    msgEl.classList.add('msg-error');
    msgEl.classList.remove('msg-loading');
  }
}

function buildSystemPrompt(taskType, includePageContext) {
  const parts = [
    'You are AI Browse, a browser-automation agent. Be direct and action-oriented.',
    'Do not narrate future actions. Produce the next concrete browser step, code change, or routing decision.',
  ];
  if (taskType === 'browse') parts.push('Handle browser automation: DOM reading, page-state reasoning, multi-step execution.');
  else if (taskType === 'reason') parts.push('Complex reasoning: long-horizon planning, ambiguous flows, large context.');
  else if (taskType === 'code') parts.push('Code-agent: generate selectors, wrappers, orchestration logic.');
  else if (taskType === 'extract') parts.push('Fast extraction: summarize, extract, normalize data.');
  else if (taskType === 'scrap') parts.push('Low-cost coding/scraping. Keep it simple.');

  if (includePageContext && window._pageContext) {
    parts.push(`\nPage: ${window._pageContext.url}\nTitle: ${window._pageContext.title}`);
    if (window._pageContext.selectedText) parts.push(`Selection: "${window._pageContext.selectedText}"`);
  }
  return parts.join('\n');
}

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

function estimateTokens(text) { return Math.ceil(text.length / 4); }
function scrollToBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

document.addEventListener('DOMContentLoaded', init);
setInterval(loadRouterInfo, 10000);
