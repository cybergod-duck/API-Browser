/**
 * model_router.js — Intelligent Model Routing Engine
 *
 * Routes browser-automation tasks to the optimal model based on:
 *   - Task type (browse, reason, code, extract, scrap)
 *   - Cost efficiency (DeepSeek direct preferred)
 *   - Reasoning strength required
 *   - Speed requirements
 *   - Browser-automation suitability
 *
 * Routing order:
 *   Primary:  DeepSeek V4-Flash (DeepSeek API)
 *   Fallback: Kimi K2.6 (Moonshot AI)
 *   Fallback: Grok Build 0.1 (x.ai)
 *   Fast:     Groq Llama 3 (Groq API)
 *   Cheap:    Qwen3 Coder (OpenRouter)
 */

import { PROVIDER_CONFIG } from './secure_config.js';

// ─── Runtime Key Storage ─────────────────────────────────────────────────
// Keys set via the onboarding wizard are stored in chrome.storage.sync
// and merged over the defaults at startup.
let _runtimeKeys = {};

/**
 * Load user API keys from chrome.storage.sync and merge into PROVIDER_CONFIG.
 * Called once at background startup.
 */
export async function loadUserKeys() {
  try {
    const { aiBrowseApiKeys } = await chrome.storage.sync.get('aiBrowseApiKeys');
    if (aiBrowseApiKeys) {
      _runtimeKeys = aiBrowseApiKeys;
      // Merge into PROVIDER_CONFIG
      for (const [provider, key] of Object.entries(aiBrowseApiKeys)) {
        if (PROVIDER_CONFIG[provider]) {
          PROVIDER_CONFIG[provider].apiKey = key;
        }
      }
    }
  } catch (e) {
    // chrome.storage may not be available (node.js tests, etc.)
    console.warn('[AI Browse] Could not load storage keys:', e.message);
  }
  return PROVIDER_CONFIG;
}

/**
 * Update a specific provider's API key at runtime and persist to storage.
 */
export async function setUserKey(provider, apiKey) {
  _runtimeKeys[provider] = apiKey;
  if (PROVIDER_CONFIG[provider]) {
    PROVIDER_CONFIG[provider].apiKey = apiKey;
  }
  await chrome.storage.sync.set({ aiBrowseApiKeys: { ..._runtimeKeys } });
}

/**
 * Get user-stored key for a provider.
 */
export function getUserKey(provider) {
  return _runtimeKeys[provider] || null;
}

// ─── Task Type Definitions ───────────────────────────────────────────────

const TASK_PROFILES = {
  browse: {
    label: 'Browser Automation',
    description: 'DOM reading, page-state reasoning, multi-step execution',
    recommended: 'deepseek',
    fallbacks: ['kimi', 'grok', 'groq', 'openrouter'],
    maxRetries: 2,
  },
  reason: {
    label: 'Complex Reasoning',
    description: 'Long-horizon planning, ambiguous flows, large context',
    recommended: 'kimi',
    fallbacks: ['grok', 'deepseek', 'groq', 'openrouter'],
    maxRetries: 3,
  },
  code: {
    label: 'Code / Tool Agent',
    description: 'Selector generation, orchestration, automation code',
    recommended: 'grok',
    fallbacks: ['deepseek', 'kimi', 'openrouter', 'groq'],
    maxRetries: 2,
  },
  extract: {
    label: 'Extraction / Classification',
    description: 'Short, cheap subtasks: summarization, link extraction, transforms',
    recommended: 'groq',
    fallbacks: ['deepseek', 'openrouter', 'kimi', 'grok'],
    maxRetries: 1,
  },
  scrap: {
    label: 'Coding / Scraping Backup',
    description: 'Low-cost coding, scraping logic, overflow',
    recommended: 'openrouter',
    fallbacks: ['deepseek', 'groq', 'kimi', 'grok'],
    maxRetries: 1,
  },
};

// ─── Model Provider Metadata ─────────────────────────────────────────────

const MODEL_META = {
  deepseek: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    displayName: 'DeepSeek V4-Flash',
    costPer1KTokens: 0.00014,
    speed: 'fast',
    reasoning: 'strong',
    browseSuitability: 5,
    apiType: 'openai-compatible',
  },
  kimi: {
    provider: 'moonshot',
    model: 'moonshot-v1-auto',
    displayName: 'Kimi K2.6',
    costPer1KTokens: 0.0008,
    speed: 'medium',
    reasoning: 'very-strong',
    browseSuitability: 4,
    apiType: 'openai-compatible',
  },
  grok: {
    provider: 'xai',
    model: 'grok-build',
    displayName: 'Grok Build 0.1',
    costPer1KTokens: 0.0005,
    speed: 'medium',
    reasoning: 'strong',
    browseSuitability: 3,
    apiType: 'openai-compatible',
  },
  groq: {
    provider: 'groq',
    model: 'llama3-8b-8192',
    displayName: 'Groq Llama 3',
    costPer1KTokens: 0.00005,
    speed: 'very-fast',
    reasoning: 'moderate',
    browseSuitability: 2,
    apiType: 'openai-compatible',
  },
  openrouter: {
    provider: 'openrouter',
    model: 'qwen/qwen3-coder',
    displayName: 'Qwen3 Coder',
    costPer1KTokens: 0.00004,
    speed: 'medium',
    reasoning: 'moderate',
    browseSuitability: 2,
    apiType: 'openai-compatible',
  },
};

// ─── Router State ────────────────────────────────────────────────────────

let sessionState = {
  activeModel: null,
  failureCount: {},
  mode: 'auto',           // 'auto' | 'manual'
  manualSelection: null,  // null = auto, otherwise provider key
  taskHistory: [],
};

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Set the routing mode.
 * @param {'auto'|'manual'} mode
 * @param {string|null} modelKey Provider key for manual mode (e.g. 'deepseek')
 */
function setMode(mode, modelKey = null) {
  sessionState.mode = mode;
  sessionState.manualSelection = modelKey;
  console.log(`[AI Browse] Router mode set to ${mode}${modelKey ? ' → ' + modelKey : ''}`);
}

/**
 * Returns the current mode and selected model.
 */
function getMode() {
  return {
    mode: sessionState.mode,
    selected: sessionState.manualSelection,
    active: sessionState.activeModel,
  };
}

/**
 * Get the configured API parameters for the current or specified model.
 * @param {string} [forcedProvider] - Override routing and use this provider
 * @returns {object} { provider, baseUrl, apiKey, model, displayName }
 */
function getModelConfig(forcedProvider = null) {
  // Manual mode override
  if (sessionState.mode === 'manual' && sessionState.manualSelection) {
    forcedProvider = sessionState.manualSelection;
  }
  return resolveConfig(forcedProvider);
}

/**
 * Route a task to the best model, then the API config.
 * Records the task and handles automatic fallback on failure.
 *
 * @param {string} taskType - One of: 'browse' | 'reason' | 'code' | 'extract' | 'scrap'
 * @param {object} [options]
 * @param {number}  [options.contextSize]     - Estimated context size in tokens
 * @param {boolean} [options.isRetry]         - True if this is a retry after failure
 * @param {number}  [options.failureCount]    - Number of prior failures on this task
 * @returns {object} { provider: string, baseUrl: string, apiKey: string, model: string, displayName: string }
 */
function routeTask(taskType, options = {}) {
  const profile = TASK_PROFILES[taskType];
  if (!profile) {
    console.warn(`[AI Browse] Unknown task type "${taskType}", falling back to browse profile.`);
    return routeTask('browse', options);
  }

  // Manual mode bypass
  if (sessionState.mode === 'manual' && sessionState.manualSelection) {
    const config = resolveConfig(sessionState.manualSelection);
    if (config) {
      sessionState.activeModel = sessionState.manualSelection;
      logTask(taskType, config);
      return config;
    }
    console.warn(`[AI Browse] Manual selection "${sessionState.manualSelection}" not found, falling back to auto.`);
  }

  const failureCount = options.failureCount || 0;
  const isRetry = options.isRetry || false;

  // Determine escalation level based on failures
  let candidateKey;
  if (failureCount >= 2) {
    // Two+ failures: escalate to next fallback
    const currentFallbackIndex = Math.min(failureCount - 1, profile.fallbacks.length - 1);
    candidateKey = profile.fallbacks[currentFallbackIndex] || profile.fallbacks[profile.fallbacks.length - 1];
  } else {
    // Normal: use recommended model, but check context
    candidateKey = profile.recommended;
  }

  // If context is very large, prefer Kimi
  if ((options.contextSize || 0) > 32000 && candidateKey !== 'kimi') {
    console.log('[AI Browse] Large context detected, routing to Kimi for capacity.');
    candidateKey = 'kimi';
  }

  // If speed-critical and candidate is slow, drop to groq
  if (profile.recommended === 'extract' && candidateKey !== 'groq') {
    candidateKey = 'groq';
  }

  const config = resolveConfig(candidateKey);
  if (!config) {
    // Fallback chain
    for (const fallback of profile.fallbacks) {
      const fbConfig = resolveConfig(fallback);
      if (fbConfig) {
        sessionState.activeModel = fallback;
        logTask(taskType, fbConfig);
        return fbConfig;
      }
    }
    throw new Error('[AI Browse] No configured provider available.');
  }

  sessionState.activeModel = candidateKey;
  logTask(taskType, config, failureCount);
  return config;
}

/**
 * Record a model failure to drive automatic fallback escalation.
 * @param {string} providerKey
 */
function recordFailure(providerKey) {
  sessionState.failureCount[providerKey] = (sessionState.failureCount[providerKey] || 0) + 1;
}

/**
 * Get the full routing history for the current session.
 */
function getTaskHistory() {
  return sessionState.taskHistory;
}

/**
 * Reset all session state (failures, history, active model).
 */
function resetSession() {
  sessionState = {
    activeModel: null,
    failureCount: {},
    mode: 'auto',
    manualSelection: null,
    taskHistory: [],
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────

function resolveConfig(providerKey) {
  if (!providerKey) return null;
  const meta = MODEL_META[providerKey];
  if (!meta) return null;
  const pConfig = PROVIDER_CONFIG[meta.provider];
  if (!pConfig || !pConfig.apiKey || pConfig.apiKey.startsWith('YOUR_')) return null;
  return {
    provider: meta.provider,
    baseUrl: pConfig.baseUrl,
    apiKey: pConfig.apiKey,
    model: meta.model,
    displayName: meta.displayName,
    costPer1KTokens: meta.costPer1KTokens,
    speed: meta.speed,
    reasoning: meta.reasoning,
  };
}

function logTask(taskType, config, failureCount = 0) {
  sessionState.taskHistory.push({
    taskType,
    model: config.displayName,
    provider: config.provider,
    timestamp: Date.now(),
    failureCount,
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────

export {
  routeTask,
  getModelConfig,
  setMode,
  getMode,
  recordFailure,
  getTaskHistory,
  resetSession,
  TASK_PROFILES,
  MODEL_META,
};
