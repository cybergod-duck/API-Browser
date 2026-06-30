/**
 * popup.js — Model Router Popup with Live Catalog
 */

const $ = (sel) => document.querySelector(sel);

const modeSelect = $('#mode-select');
const manualPicker = $('#manual-picker');
const modelSelect = $('#model-select');
const activeDisplay = $('#active-display');
const activeCost = $('#active-cost');
const taskButtons = $('#task-buttons');
const pageTitle = $('#page-title');
const pageUrl = $('#page-url');
const historyList = $('#history-list');
const resetBtn = $('#reset-btn');
const openPanelBtn = $('#open-panel-btn');
const statusDot = $('#status-dot');

let routerInfo = null;

async function init() {
  const { setupDone } = await chrome.runtime.sendMessage({ type: 'GET_SETUP_STATUS' });
  const keyStatus = await chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' });
  const hasAnyKey = Object.values(keyStatus || {}).some(Boolean);

  if (!setupDone || !hasAnyKey) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding.html') });
    window.close();
    return;
  }

  await loadRouterInfo();
  await loadModelCatalog();
  populateTaskButtons();
  updateActiveDisplay();
  updatePageInfo();
  updateHistory();

  modeSelect.addEventListener('change', onModeChange);
  modelSelect.addEventListener('change', onModelChange);
  resetBtn.addEventListener('click', onReset);
  openPanelBtn.addEventListener('click', onOpenPanel);
}

async function loadModelCatalog() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CATALOG' });
  if (resp.ok && resp.recommended?.length > 0) {
    populateModelSelectFromCatalog(resp.recommended);
  } else {
    const discover = await chrome.runtime.sendMessage({ type: 'DISCOVER_MODELS' });
    if (discover.ok && discover.recommended) {
      populateModelSelectFromCatalog(discover.recommended);
    }
  }
}

async function loadRouterInfo() {
  routerInfo = await chrome.runtime.sendMessage({ type: 'GET_ROUTER_INFO' });
}

function populateModelSelectFromCatalog(recommended) {
  modelSelect.innerHTML = '';
  for (const model of recommended) {
    const opt = document.createElement('option');
    opt.value = `${model.provider}:${model.id}`;
    const icon = model.tier === 'recommended' ? '⭐' : '✓';
    const ctx = model.contextLength ? `(${(model.contextLength/1000).toFixed(0)}k ctx)` : '';
    opt.textContent = `${icon} ${model.name} ${ctx}`;
    modelSelect.appendChild(opt);
  }
  if (routerInfo?.mode?.mode === 'manual' && routerInfo.mode.selected) {
    modelSelect.value = routerInfo.mode.selected;
  }
}

function populateTaskButtons() {
  taskButtons.innerHTML = '';
  for (const [key, profile] of Object.entries(routerInfo.profiles)) {
    const btn = document.createElement('button');
    btn.className = 'task-btn';
    btn.dataset.task = key;
    btn.textContent = profile.label;
    btn.title = profile.description;
    btn.addEventListener('click', () => onQuickRoute(key));
    taskButtons.appendChild(btn);
  }
}

function updateActiveDisplay() {
  if (routerInfo?.mode?.active) {
    activeDisplay.textContent = routerInfo.mode.active;
    activeCost.classList.add('hidden');
    statusDot.className = 'dot dot-green';
  } else {
    activeDisplay.textContent = 'Waiting for task...';
    activeCost.classList.add('hidden');
    statusDot.className = 'dot dot-yellow';
  }
}

async function updatePageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      pageTitle.textContent = tab.title || '(no title)';
      pageUrl.textContent = tab.url || '(no URL)';
    }
  } catch {
    pageTitle.textContent = '(unavailable)';
    pageUrl.textContent = '(unavailable)';
  }
}

async function updateHistory() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  historyList.innerHTML = '';
  if (!resp || !resp.length) {
    historyList.textContent = 'No tasks routed yet.';
    return;
  }
  const list = document.createElement('ul');
  for (const entry of resp.slice(-10).reverse()) {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.timestamp).toLocaleTimeString()} — ${entry.model} (${entry.taskType})`;
    if (entry.failureCount > 0) li.textContent += ` ⚠️x${entry.failureCount}`;
    list.appendChild(li);
  }
  historyList.appendChild(list);
}

async function onModeChange() {
  const mode = modeSelect.value;
  manualPicker.classList.toggle('hidden', mode !== 'manual');
  if (mode === 'manual') {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'manual', modelKey: modelSelect.value });
  } else {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'auto' });
  }
  await loadRouterInfo();
  updateActiveDisplay();
}

async function onModelChange() {
  if (modeSelect.value === 'manual') {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'manual', modelKey: modelSelect.value });
    await loadRouterInfo();
    updateActiveDisplay();
  }
}

async function onQuickRoute(taskType) {
  const resp = await chrome.runtime.sendMessage({ type: 'ROUTE_TASK', taskType, options: {} });
  if (resp.ok) {
    await loadRouterInfo();
    updateActiveDisplay();
    updateHistory();
  }
}

async function onReset() {
  await chrome.runtime.sendMessage({ type: 'RESET_SESSION' });
  await loadRouterInfo();
  updateActiveDisplay();
  updateHistory();
  modeSelect.value = 'auto';
  manualPicker.classList.add('hidden');
}

function onOpenPanel() {
  chrome.sidePanel.open();
  window.close();
}

document.addEventListener('DOMContentLoaded', init);
setInterval(async () => {
  await loadRouterInfo();
  updateActiveDisplay();
  updateHistory();
}, 5000);
