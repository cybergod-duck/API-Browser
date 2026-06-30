/**
 * model_router.js — Intelligent Model Routing Engine
 *
 * Routes tasks to the best available model. No hardcoded model lists.
 * Uses provider_registry for connection metadata and model_catalog
 * for live discovery, normalization, and scoring.
 */

import { PROVIDER_CONFIG } from './secure_config.js';
import { PROVIDER_REGISTRY, getProviderMeta, supportsModelListing } from './provider_registry.js';
import { getCatalog, getRecommendedModels, scoreModel } from './model_catalog.js';

// ─── Runtime Key Storage ─────────────────────────────────────────────────

let _runtimeKeys = {};

export async function loadUserKeys() {
  try {
    const { aiBrowseApiKeys } = await chrome.storage.sync.get('aiBrowseApiKeys');
    if (aiBrowseApiKeys) {
      _runtimeKeys = aiBrowseApiKeys;
      for (const [provider, key] of Object.entries(aiBrowseApiKeys)) {
        if (PROVIDER_CONFIG[provider]) PROVIDER_CONFIG[provider].apiKey = key;
      }
    }
  } catch (e) {
    console.warn('[AI Browse] Could not load storage keys:', e.message);
  }
  return PROVIDER_CONFIG;
}

export async function setUserKey(provider, apiKey) {
  _runtimeKeys[provider] = apiKey;
  if (PROVIDER_CONFIG[provider]) PROVIDER_CONFIG[provider].apiKey = apiKey;
  await chrome.storage.sync.set({ aiBrowseApiKeys: { ..._runtimeKeys } });
}

export function getUserKey(provider) {
  return _runtimeKeys[provider] || null;
}

export function getKeyStatus() {
  const status = {};
  for (const [key, meta] of Object.entries(PROVIDER_REGISTRY)) {
    const hasRuntimeKey = !!_runtimeKeys[key];
    const pConfig = PROVIDER_CONFIG[key];
    const hasConfigKey = !!(pConfig && pConfig.apiKey && !pConfig.apiKey.startsWith('YOUR_'));
    status[key] = hasRuntimeKey || hasConfigKey;
  }
  return status;
}

export function hasAnyKey() {
  return Object.values(getKeyStatus()).some(Boolean);
}

// ─── Task Type Definitions ───────────────────────────────────────────────

export const TASK_PROFILES = {
  browse: {
    label: 'Browser Automation',
    description: 'DOM reading, page-state reasoning, multi-step execution',
    recommendedTraits: ['code', 'instruct', 'chat'],
    maxRetries: 2,
  },
  reason: {
    label: 'Complex Reasoning',
    description: 'Long-horizon planning, ambiguous flows, large context',
    recommendedTraits: ['heavyweight', 'instruct'],
    maxRetries: 3,
  },
  code: {
    label: 'Code / Tool Agent',
    description: 'Selector generation, orchestration, automation code',
    recommendedTraits: ['code', 'heavyweight'],
    maxRetries: 2,
  },
  extract: {
    label: 'Extraction / Classification',
    description: 'Short, cheap subtasks',
    recommendedTraits: ['lightweight', 'chat'],
    maxRetries: 1,
  },
  scrap: {
    label: 'Coding / Scraping Backup',
    description: 'Low-cost coding, scraping logic',
    recommendedTraits: ['code', 'lightweight'],
    maxRetries: 1,
  },
};

// ─── Router State ────────────────────────────────────────────────────────

let sessionState = {
  activeModel: null,
  failureCount: {},
  mode: 'auto',
  manualSelection: null,
  taskHistory: [],
};

export function setMode(mode, modelKey = null) {
  sessionState.mode = mode;
  sessionState.manualSelection = modelKey;
  console.log(`[AI Browse] Router mode: ${mode}${modelKey ? ' → ' + modelKey : ''}`);
}

export function getMode() {
  return {
    mode: sessionState.mode,
    selected: sessionState.manualSelection,
    active: sessionState.activeModel,
  };
}

// ─── Dynamic Routing ─────────────────────────────────────────────────────

export async function routeTask(taskType, options = {}) {
  const profile = TASK_PROFILES[taskType] || TASK_PROFILES.browse;

  // Manual mode bypass
  if (sessionState.mode === 'manual' && sessionState.manualSelection) {
    const config = await resolveConfig(sessionState.manualSelection);
    if (config) {
      sessionState.activeModel = sessionState.manualSelection;
      logTask(taskType, config);
      return config;
    }
  }

  // Get live catalog
  const keys = {};
  for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
    if (config.apiKey && !config.apiKey.startsWith('YOUR_')) keys[provider] = config.apiKey;
  }
  const catalog = await getCatalog(keys, false);
  const recommended = getRecommendedModels(catalog);

  // Score candidates by task fit
  let candidates = recommended;
  if (options.failureCount > 0) {
    // On failure, expand to all capable models
    const all = [];
    for (const [provider, models] of Object.entries(catalog)) {
      for (const m of models) {
        const scored = scoreModel(m);
        all.push({ ...m, ...scored });
      }
    }
    candidates = all.filter(m => m.tier !== 'limited').sort((a, b) => b.score - a.score);
  }

  // Pick best match for task type
  const best = pickBestForTask(candidates, profile, options);
  if (!best) throw new Error('No suitable model available.');

  const config = await resolveConfig(`${best.provider}:${best.id}`);
  sessionState.activeModel = `${best.provider}:${best.id}`;
  logTask(taskType, config, options.failureCount || 0);
  return config;
}

function pickBestForTask(candidates, profile, options) {
  // Prefer models with matching traits
  for (const trait of profile.recommendedTraits) {
    const match = candidates.find(c => c.tags?.includes(trait));
    if (match) return match;
  }
  // Fallback: highest scored
  return candidates[0] || null;
}

export function getModelConfig(forcedProvider = null) {
  if (sessionState.mode === 'manual' && sessionState.manualSelection) {
    forcedProvider = sessionState.manualSelection;
  }
  return resolveConfig(forcedProvider);
}

async function resolveConfig(providerModelKey) {
  if (!providerModelKey) return null;
  const [provider, modelId] = providerModelKey.includes(':')
    ? providerModelKey.split(':')
    : [providerModelKey, null];

  const pConfig = PROVIDER_CONFIG[provider];
  if (!pConfig || !pConfig.apiKey || pConfig.apiKey.startsWith('YOUR_')) return null;

  // If modelId specified, use it; otherwise need to discover
  let resolvedModelId = modelId;
  if (!resolvedModelId) {
    const meta = getProviderMeta(provider);
    if (meta?.fallbackModels?.[0]) {
      resolvedModelId = meta.fallbackModels[0].id;
    } else {
      // Try to discover
      try {
        const { fetchProviderModels } = await import('./model_catalog.js');
        const models = await fetchProviderModels(provider, pConfig.apiKey);
        if (models[0]) resolvedModelId = models[0].id;
      } catch { /* ignore */ }
    }
  }

  return {
    provider,
    baseUrl: pConfig.baseUrl,
    apiKey: pConfig.apiKey,
    model: resolvedModelId || 'unknown',
    displayName: resolvedModelId || provider,
  };
}

export function recordFailure(providerKey) {
  sessionState.failureCount[providerKey] = (sessionState.failureCount[providerKey] || 0) + 1;
}

export function getTaskHistory() {
  return sessionState.taskHistory;
}

export function resetSession() {
  sessionState = {
    activeModel: null,
    failureCount: {},
    mode: 'auto',
    manualSelection: null,
    taskHistory: [],
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