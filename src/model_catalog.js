/**
 * model_catalog.js — Live Model Discovery, Cache & Scoring
 */

import { getProviderMeta, supportsModelListing } from './provider_registry.js';

const CACHE_KEY = 'aiBrowseModelCatalog';
const CACHE_TTL_MS = 1000 * 60 * 60;

async function loadCache() {
  try {
    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (!cache) return null;
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) return null;
    return cache.data;
  } catch { return null; }
}

async function saveCache(data) {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: { timestamp: Date.now(), data } });
  } catch (e) {
    console.warn('[AI Browse] Could not save model catalog cache:', e);
  }
}

export async function fetchProviderModels(providerKey, apiKey) {
  const meta = getProviderMeta(providerKey);
  if (!meta) throw new Error(`Unknown provider: ${providerKey}`);
  if (!meta.supportsModelListing) return meta.fallbackModels || [];

  const headers = {};
  if (meta.authHeader === 'x-goog-api-key') {
    const url = new URL(meta.modelsEndpoint, meta.baseUrl);
    url.searchParams.set('key', apiKey);
    const resp = await fetch(url.toString(), { headers });
    if (!resp.ok) throw new Error(`Gemini list error: ${resp.status}`);
    return meta.listParser(await resp.json());
  }

  headers[meta.authHeader] = `${meta.authPrefix}${apiKey}`;
  const resp = await fetch(`${meta.baseUrl}${meta.modelsEndpoint}`, { headers });
  if (!resp.ok) throw new Error(`Model list error ${resp.status}: ${await resp.text()}`);
  return meta.listParser(await resp.json());
}

export async function discoverAllModels(providerKeys) {
  const results = {};
  for (const [provider, key] of Object.entries(providerKeys)) {
    try {
      const models = await fetchProviderModels(provider, key);
      results[provider] = models.map(m => normalizeModel(m, provider));
    } catch (err) {
      console.warn(`[AI Browse] Failed to list models for ${provider}:`, err.message);
      const meta = getProviderMeta(provider);
      results[provider] = (meta?.fallbackModels || []).map(m => normalizeModel(m, provider));
    }
  }
  await saveCache(results);
  return results;
}

function normalizeModel(raw, provider) {
  return {
    id: raw.id,
    name: raw.name || raw.id,
    provider,
    contextLength: raw.contextLength || null,
    pricing: raw.pricing || {},
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

export function scoreModel(model) {
  let score = 50;
  if (model.contextLength) {
    if (model.contextLength >= 128000) score += 20;
    else if (model.contextLength >= 32000) score += 15;
    else if (model.contextLength >= 8000) score += 10;
    else score += 5;
  }
  const tags = model.tags || [];
  if (tags.includes('code')) score += 15;
  if (tags.includes('instruct')) score += 10;
  if (tags.includes('chat')) score += 5;
  if (tags.includes('heavyweight')) score += 10;
  if (tags.includes('lightweight')) score -= 10;
  if (tags.includes('vision')) score += 5;
  if (tags.includes('embedding')) score -= 30;
  if (tags.includes('audio')) score -= 30;
  if (tags.includes('image-gen')) score -= 30;

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

export function getRecommendedModels(catalog) {
  const recommended = [];
  for (const [provider, models] of Object.entries(catalog)) {
    for (const model of models) {
      const { score, tier } = scoreModel(model);
      if (tier === 'recommended') recommended.push({ ...model, score, tier });
    }
  }
  return recommended.sort((a, b) => b.score - a.score);
}

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

export async function getCatalog(providerKeys, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await loadCache();
    if (cached) return cached;
  }
  return discoverAllModels(providerKeys);
}

export async function clearCatalogCache() {
  await chrome.storage.local.remove(CACHE_KEY);
}
