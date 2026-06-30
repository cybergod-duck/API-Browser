/**
 * background.js — Service Worker
 *
 * Handles message routing between popup, panel, and content scripts.
 * Manages API calls to model providers and communication with the active tab.
 */

import { PROVIDER_CONFIG } from './secure_config.js';
import { routeTask, getModelConfig, setMode, getMode, recordFailure, getTaskHistory, resetSession, TASK_PROFILES, MODEL_META, loadUserKeys, getKeyStatus } from './model_router.js';

// ─── Message Handlers ────────────────────────────────────────────────────

const MESSAGE_HANDLERS = {
  /** Check if the user has completed onboarding */
  GET_SETUP_STATUS: async () => {
    const { aiBrowseSetupDone } = await chrome.storage.sync.get('aiBrowseSetupDone');
    return { setupDone: !!aiBrowseSetupDone };
  },

  /** Mark setup as complete (called by onboarding wizard) */
  SETUP_COMPLETE: async () => {
    await chrome.storage.sync.set({ aiBrowseSetupDone: true });
    return { ok: true };
  },

  /** Save or update a single API key */
  SAVE_API_KEY: async (msg) => {
    const { provider, apiKey } = msg;
    const { setUserKey } = await import('./model_router.js');
    await setUserKey(provider, apiKey);
    return { ok: true };
  },

  /** Get which providers have keys configured — single source of truth */
  GET_KEY_STATUS: () => getKeyStatus(),

  /** Get the current routing mode and active model */
  GET_MODE: () => getMode(),

  /** Set routing mode: { mode: 'auto'|'manual', modelKey?: string } */
  SET_MODE: (msg) => {
    setMode(msg.mode, msg.modelKey || null);
    return { ok: true, mode: getMode() };
  },

  /** Route a task and return the API config for the chosen model */
  ROUTE_TASK: (msg) => {
    try {
      const config = routeTask(msg.taskType, msg.options || {});
      return { ok: true, config };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /** Get all available task profiles and model metadata */
  GET_ROUTER_INFO: () => ({
    profiles: TASK_PROFILES,
    models: Object.fromEntries(
      Object.entries(MODEL_META).map(([k, v]) => [k, { displayName: v.displayName, costPer1KTokens: v.costPer1KTokens, speed: v.speed, reasoning: v.reasoning }])
    ),
    mode: getMode(),
  }),

  /** Make an API call to a model provider (used by panel/popup for direct chat) */
  CHAT_COMPLETION: async (msg) => {
    const { provider, messages, options } = msg;
    return handleChatCompletion(provider, messages, options);
  },

  /** Record a model failure (triggers escalation) */
  RECORD_FAILURE: (msg) => {
    recordFailure(msg.providerKey);
    return { ok: true };
  },

  /** Get task history */
  GET_HISTORY: () => {
    return getTaskHistory();
  },

  /** Reset router session state */
  RESET_SESSION: () => {
    resetSession();
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
    return true; // keep channel open for async
  }
  sendResponse(result);
  return false;
});

// ─── Chat Completion Helper ──────────────────────────────────────────────

async function handleChatCompletion(provider, messages, options = {}) {
  let config;
  if (provider) {
    config = getModelConfig(provider);
  } else {
    const taskType = options.taskType || 'browse';
    const routed = routeTask(taskType, options);
    config = getModelConfig(routed.provider);
  }
  if (!config) {
    return { ok: false, error: 'No provider configured. Check API keys in secure_config.js.' };
  }

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

  // OpenRouter requires an additional header
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

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: `API error ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    return { ok: true, data, model: config.displayName };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

// ─── Side Panel Open on Action Click ─────────────────────────────────────

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// ─── Boot: Load saved keys from storage ──────────────────────────────────
loadUserKeys().then(() => {
  console.log('[AI Browse] User API keys loaded from storage.');
});

console.log('[AI Browse] Background service worker loaded.');
