/**
 * model_catalog.js — Live Model Discovery, Cache & Scoring
 *
 * Fetches current model catalogs from providers, normalizes them,
 * scores for browser-automation suitability, and caches results.
 */

import { getProviderMeta, supportsModelListing } from './provider_registry.js';

// ─── Cache Storage ───────────────────────────────────────────────────────

const CACHE_KEY = 'aiBrowseModelCatalog';
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

/**
 * Load cached catalog from chrome.storage.local.
 */
async function loadCache() {
  try {
    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (!cache) return null;
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) return null; // expired
    return cache.data;
  } catch {
    return null;
  }
}

/**
 * Save catalog to chrome.storage.local.
 */
async function saveCache(data) {
  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { timestamp: Date.now(), data },
    });
  } catch (e) {
    console.warn('[AI Browse] Could not save model catalog cache:', e);
  }
}

// ─── Live Discovery ──────────────────────────────────────────────────────

/**
 * Fetch live model list from a provider's API.
 * @param {string} providerKey — e.g. 'openrouter', 'groq'
 * @param {string} apiKey — the user's API key for this provider
 * @returns {Promise<Array<{id, name, contextLength, pricing}>>}
 */
export async function fetchProviderModels(providerKey, apiKey) {
  const meta = getProviderMeta(providerKey);
  if (!meta) throw new Error(`Unknown provider: ${providerKey}`);

  // Provider doesn't support listing — return fallback
  if (!meta.supportsModelListing) {
    return meta.fallbackModels || [];
  }

  const headers = {};
  if (meta.authHeader === 'x-goog-api-key') {
    // Gemini uses query param
    const url = new URL(meta.modelsEndpoint, meta.baseUrl);
    url.searchParams.set('key', apiKey);
    const resp = await fetch(url.toString(), { headers });
    if (!resp.ok) throw new Error(`Gemini list error: ${resp.status}`);
    const json = await resp.json();
    return meta.listParser(json);
  }

  headers[meta.authHeader] = `${meta.authPrefix}${apiKey}`;
  const resp = await fetch(`${meta.baseUrl}${meta.modelsEndpoint}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Model list error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return meta.listParser(json);
}

/**
 * Discover models for all configured providers.
 * @param {Object} providerKeys — { providerKey: apiKey }
 * @returns {Promise<Object>} — { providerKey: [normalizedModels] }
 */
export async function discoverAllModels(providerKeys) {
  const results = {};
  for (const [provider, key] of Object.entries(providerKeys)) {
    try {
      const models = await fetchProviderModels(provider, key);
      results[provider] = models.map(m => normalizeModel(m, provider));
    } catch (err) {
      console.warn(`[AI Browse] Failed to list models for ${provider}:`, err.message);
      // Use fallback if available
      const meta = getProviderMeta(provider);
      results[provider] = (meta?.fallbackModels || []).map(m => normalizeModel(m, provider));
    }
  }
  await saveCache(results);
  return results;
}

// ─── Normalization ───────────────────────────────────────────────────────

/**
 * Normalize a raw model object into a standard schema.
 */
function normalizeModel(raw, provider) {
  return {
    id: raw.id,
    name: raw.name || raw.id,
    provider,
    contextLength: raw.contextLength || null,
    pricing: raw.pricing || {},
    // Scoring inputs
    tags: extractTags(raw),
    raw,
  };
}

function extractTags(raw) {
  const tags = [];
  const id = (raw.id || '').toLowerCase();
  const name = (raw.name || '').toLowerCase();

  if (id.includes('vision') || name.includes('vision')) tags.push('vision');
  if (id.includes('instruct') || name.includes('instruct')) tags.push('instruct');
  if (id.includes('chat') || name.includes('chat')) tags.push('chat');
  if (id.includes('code') || name.includes('code')) tags.push('code');
  if (id.includes('lite') || name.includes('lite') || id.includes('mini')) tags.push('lightweight');
  if (id.includes('pro') || name.includes('pro') || id.includes('max')) tags.push('heavyweight');
  if (id.includes('embed') || name.includes('embed')) tags.push('embedding');
  if (id.includes('tts') || name.includes('audio')) tags.push('audio');
  if (id.includes('image') || name.includes('image')) tags.push('image-gen');

  return tags;
}

// ─── Browser-Automation Suitability Scoring ──────────────────────────────

/**
 * Score a model for browser-automation suitability.
 * Returns 0-100 score and tier classification.
 */
export function scoreModel(model) {
  let score = 50; // baseline

  // Context length bonus (longer = better for DOM + page state)
  if (model.contextLength) {
    if (model.contextLength >= 128000) score += 20;
    else if (model.contextLength >= 32000) score += 15;
    else if (model.contextLength >= 8000) score += 10;
    else score += 5;
  }

  // Tag-based scoring
  const tags = model.tags || [];
  if (tags.includes('code')) score += 15; // code = good for selectors/automation
  if (tags.includes('instruct')) score += 10; // instruct = good at following directions
  if (tags.includes('chat')) score += 5;
  if (tags.includes('heavyweight')) score += 10; // stronger reasoning
  if (tags.includes('lightweight')) score -= 10; // may lack capability
  if (tags.includes('vision')) score += 5; // vision = can process screenshots
  if (tags.includes('embedding')) score -= 30; // not a chat model
  if (tags.includes('audio')) score -= 30;
  if (tags.includes('image-gen')) score -= 30;

  // Provider-specific heuristics
  const id = (model.id || '').toLowerCase();
  if (id.includes('claude') && (id.includes('opus') || id.includes('sonnet'))) score += 10;
  if (id.includes('gpt-4') && !id.includes('mini')) score += 10;
  if (id.includes('gpt-3.5') || id.includes('gpt-4o-mini')) score -= 5;
  if (id.includes('qwen') && id.includes('coder')) score += 10;
  if (id.includes('deepseek') && id.includes('chat')) score += 10;
  if (id.includes('llama') && id.includes('70b')) score += 5;
  if (id.includes('llama') && id.includes('8b')) score -= 5;

  return {
    score: Math.max(0, Math.min(100, score)),
    tier: score >= 70 ? 'recommended' : score >= 40 ? 'capable' : 'limited',
  };
}

// ─── Filtering ───────────────────────────────────────────────────────────

/**
 * Get recommended models for browser automation (default UI).
 */
export function getRecommendedModels(catalog) {
  const recommended = [];
  for (const [provider, models] of Object.entries(catalog)) {
    for (const model of models) {
      const { score, tier } = scoreModel(model);
      if (tier === 'recommended') {
        recommended.push({ ...model, score, tier });
      }
    }
  }
  return recommended.sort((a, b) => b.score - a.score);
}

/**
 * Get all models with scores (advanced toggle).
 */
export function getAllScoredModels(catalog) {
  const all = [];
  for (const [provider, models] of Object.entries(catalog)) {
    for (const model of models) {
      const { score, tier } = scoreModel(model);
      all.push({ ...model, score, tier });
    }
  }
  return all.sort((a, b) => b.score - a.score);
}

/**
 * Get models grouped by provider.
 */
export function getModelsByProvider(catalog) {
  const grouped = {};
  for (const [provider, models] of Object.entries(catalog)) {
    grouped[provider] = models.map(m => {
      const { score, tier } = scoreModel(m);
      return { ...m, score, tier };
    }).sort((a, b) => b.score - a.score);
  }
  return grouped;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Get the current catalog (from cache or trigger discovery).
 */
export async function getCatalog(providerKeys, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await loadCache();
    if (cached) return cached;
  }
  return discoverAllModels(providerKeys);
}

/**
 * Clear the catalog cache.
 */
export async function clearCatalogCache() {
  await chrome.storage.local.remove(CACHE_KEY);
}