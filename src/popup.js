/**
 * popup.js — Model Router Popup Logic
 *
 * Handles the popup UI: mode toggling, manual model selection,
 * task quick-routing, and session status display.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── DOM References ──────────────────────────────────────────────────────

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

// ─── Initialization ──────────────────────────────────────────────────────

let routerInfo = null;

async function init() {
  // Check if onboarding is needed
  const { setupDone } = await chrome.runtime.sendMessage({ type: 'GET_SETUP_STATUS' });
  const keyStatus = await chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' });
  const hasAnyKey = Object.values(keyStatus || {}).some(Boolean);

  if (!setupDone || !hasAnyKey) {
    // Redirect to onboarding wizard
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding.html') });
    window.close();
    return;
  }

  await loadRouterInfo();
  populateModelSelect();
  populateTaskButtons();
  updateActiveDisplay();
  updatePageInfo();
  updateHistory();

  // Event listeners
  modeSelect.addEventListener('change', onModeChange);
  modelSelect.addEventListener('change', onModelChange);
  resetBtn.addEventListener('click', onReset);
  openPanelBtn.addEventListener('click', onOpenPanel);
}

async function loadRouterInfo() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_ROUTER_INFO' });
  routerInfo = resp;
}

// ─── Model Select ────────────────────────────────────────────────────────

function populateModelSelect() {
  modelSelect.innerHTML = '';
  for (const [key, meta] of Object.entries(routerInfo.models)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${meta.displayName} (${meta.costPer1KTokens}c/k)`;
    modelSelect.appendChild(opt);
  }
  if (routerInfo.mode.mode === 'manual') {
    modelSelect.value = routerInfo.mode.selected || 'deepseek';
  }
}

// ─── Task Buttons ────────────────────────────────────────────────────────

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

// ─── Display Updates ─────────────────────────────────────────────────────

function updateActiveDisplay() {
  if (routerInfo.mode.active && routerInfo.models[routerInfo.mode.active]) {
    const meta = routerInfo.models[routerInfo.mode.active];
    activeDisplay.textContent = meta.displayName;
    activeCost.textContent = `$${meta.costPer1KTokens.toFixed(5)}/1K tokens`;
    activeCost.classList.remove('hidden');
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

// ─── Event Handlers ──────────────────────────────────────────────────────

async function onModeChange() {
  const mode = modeSelect.value;
  manualPicker.classList.toggle('hidden', mode !== 'manual');
  if (mode === 'manual') {
    await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      mode: 'manual',
      modelKey: modelSelect.value,
    });
  } else {
    await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'auto' });
  }
  await loadRouterInfo();
  updateActiveDisplay();
}

async function onModelChange() {
  if (modeSelect.value === 'manual') {
    await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      mode: 'manual',
      modelKey: modelSelect.value,
    });
    await loadRouterInfo();
    updateActiveDisplay();
  }
}

async function onQuickRoute(taskType) {
  const resp = await chrome.runtime.sendMessage({
    type: 'ROUTE_TASK',
    taskType,
    options: {},
  });
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

// ─── Boot ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

// Refresh periodic
setInterval(async () => {
  await loadRouterInfo();
  updateActiveDisplay();
  updateHistory();
}, 5000);
