/**
 * background.js — Service Worker
 */

import { PROVIDER_CONFIG } from './secure_config.js';
import { routeTask, getModelConfig, setMode, getMode, recordFailure, getTaskHistory, resetSession, TASK_PROFILES, MODEL_META, loadUserKeys, getKeyStatus } from './model_router.js';
import { getCatalog, getRecommendedModels, getAllScoredModels, clearCatalogCache } from './model_catalog.js';

const MESSAGE_HANDLERS = {
  GET_SETUP_STATUS: async () => {
    const { aiBrowseSetupDone } = await chrome.storage.sync.get('aiBrowseSetupDone');
    return { setupDone: !!aiBrowseSetupDone };
  },
  SETUP_COMPLETE: async () => {
    await chrome.storage.sync.set({ aiBrowseSetupDone: true });
    return { ok: true };
  },
  SAVE_API_KEY: async (msg) => {
    const { setUserKey } = await import('./model_router.js');
    await setUserKey(msg.provider, msg.apiKey);
    return { ok: true };
  },
  GET_KEY_STATUS: () => getKeyStatus(),
  GET_MODE: () => getMode(),
  SET_MODE: (msg) => {
    setMode(msg.mode, msg.modelKey || null);
    return { ok: true, mode: getMode() };
  },
  ROUTE_TASK: (msg) => {
    try {
      const config = routeTask(msg.taskType, msg.options || {});
      return { ok: true, config };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  GET_ROUTER_INFO: () => ({
    profiles: TASK_PROFILES,
    models: Object.fromEntries(
      Object.entries(MODEL_META).map(([k, v]) => [k, { displayName: v.displayName, costPer1KTokens: v.costPer1KTokens, speed: v.speed, reasoning: v.reasoning }])
    ),
    mode: getMode(),
  }),
  CHAT_COMPLETION: async (msg) => {
    const { provider, messages, options } = msg;
    return handleChatCompletion(provider, messages, options);
  },
  RECORD_FAILURE: (msg) => {
    recordFailure(msg.providerKey);
    return { ok: true };
  },
  GET_HISTORY: () => getTaskHistory(),
  RESET_SESSION: () => {
    resetSession();
    return { ok: true };
  },
  DISCOVER_MODELS: async () => {
    const keys = {};
    for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
      if (config.apiKey && !config.apiKey.startsWith('YOUR_')) keys[provider] = config.apiKey;
    }
    const catalog = await getCatalog(keys, true);
    return { ok: true, catalog, recommended: getRecommendedModels(catalog) };
  },
  GET_CATALOG: async () => {
    const keys = {};
    for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
      if (config.apiKey && !config.apiKey.startsWith('YOUR_')) keys[provider] = config.apiKey;
    }
    const catalog = await getCatalog(keys, false);
    return { ok: true, catalog, recommended: getRecommendedModels(catalog) };
  },
  GET_ALL_MODELS: async () => {
    const keys = {};
    for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
      if (config.apiKey && !config.apiKey.startsWith('YOUR_')) keys[provider] = config.apiKey;
    }
    const catalog = await getCatalog(keys, false);
    return { ok: true, models: getAllScoredModels(catalog) };
  },
  CLEAR_CATALOG: async () => {
    await clearCatalogCache();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[msg.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    return false;
  }
  const result = handler(msg);
  if (result instanceof Promise) {
    result.then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  sendResponse(result);
  return false;
});

async function handleChatCompletion(provider, messages, options = {}) {
  let config;
  if (provider) {
    config = getModelConfig(provider);
  } else {
    const taskType = options.taskType || 'browse';
    const routed = routeTask(taskType, options);
    config = getModelConfig(routed.provider);
  }
  if (!config) return { ok: false, error: 'No provider configured.' };

  const body = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 4096,
    stream: options.stream ?? false,
  };
  if (options.response_format) body.response_format = options.response_format;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://aibrowse.extension';
    headers['X-Title'] = 'AI Browse';
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, error: `API error ${response.status}: ${await response.text()}` };
    const data = await response.json();
    return { ok: true, data, model: config.displayName };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
loadUserKeys().then(() => console.log('[AI Browse] Keys loaded.'));
console.log('[AI Browse] Background service worker loaded.');
