/**
 * provider_registry.js — Provider Metadata & Connection Logic
 *
 * Static registry of supported providers. Contains ONLY connection
 * metadata and capability flags — never hardcoded model lists.
 */

export const PROVIDER_REGISTRY = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    // OpenRouter returns { data: [{ id, name, pricing }] }
    listParser: (json) => (json.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      contextLength: m.context_length || null,
      pricing: m.pricing || {},
    })),
    modelIdField: 'id',
  },

  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    listParser: (json) => (json.data || []).map(m => ({
      id: m.id,
      name: m.id,
      contextLength: null,
      pricing: {},
    })),
    modelIdField: 'id',
  },

  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    listParser: (json) => (json.data || []).map(m => ({
      id: m.id,
      name: m.id,
      contextLength: m.context_window || null,
      pricing: {},
    })),
    modelIdField: 'id',
  },

  moonshot: {
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',   // Updated to Kimi K2 endpoint
    supportsModelListing: false,
    modelsEndpoint: null,
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    listParser: null,
    modelIdField: 'id',
    // Kimi K2 model family
    fallbackModels: [
      { id: 'kimi-k2', name: 'Kimi K2', contextLength: 131072 },
      { id: 'kimi-k2-instruct', name: 'Kimi K2 Instruct', contextLength: 131072 },
      { id: 'moonshot-v1-8k', name: 'Kimi V1 8K (legacy)', contextLength: 8192 },
      { id: 'moonshot-v1-32k', name: 'Kimi V1 32K (legacy)', contextLength: 32768 },
      { id: 'moonshot-v1-128k', name: 'Kimi V1 128K (legacy)', contextLength: 131072 },
    ],
  },

  xai: {
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    listParser: (json) => (json.data || []).map(m => ({
      id: m.id,
      name: m.id,
      contextLength: null,
      pricing: {},
    })),
    modelIdField: 'id',
  },

  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    listParser: (json) => (json.data || []).map(m => ({
      id: m.id,
      name: m.id,
      contextLength: null,
      pricing: {},
    })),
    modelIdField: 'id',
  },

  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    authHeader: 'x-goog-api-key',
    authPrefix: '',
    listParser: (json) => (json.models || []).map(m => ({
      id: m.name.replace('models/', ''),
      name: m.displayName || m.name,
      contextLength: m.inputTokenLimit || null,
      pricing: {},
    })),
    modelIdField: 'id',
  },
};

/**
 * Get provider metadata by key.
 */
export function getProviderMeta(key) {
  return PROVIDER_REGISTRY[key] || null;
}

/**
 * Check if provider supports live model listing.
 */
export function supportsModelListing(key) {
  const meta = getProviderMeta(key);
  return meta ? meta.supportsModelListing : false;
}
