/**
 * secure_config.js — Preloaded Provider API Keys
 *
 * These keys are bundled with the extension at build time.
 * In production, distribute a .env build step or store
 * via chrome.storage.sync after first auth.
 *
 * NEVER log these values or expose them in content scripts.
 * This module is only imported by background.js (service worker).
 */

const PROVIDER_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'YOUR_DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',           // DeepSeek V4-Flash
  },
  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1',   // Kimi K2 endpoint
    apiKey: 'YOUR_MOONSHOT_API_KEY',
    defaultModel: 'kimi-k2',                 // Kimi K2 (instruct)
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    apiKey: 'YOUR_XAI_API_KEY',
    defaultModel: 'grok-3',                  // Grok 3 (coding/agentic)
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: 'YOUR_GROQ_API_KEY',
    defaultModel: 'llama3-8b-8192',          // Groq Llama 3 (fast executor)
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'YOUR_OPENROUTER_API_KEY',
    defaultModel: 'qwen/qwen3-coder',        // Qwen3 Coder via OpenRouter
  },
};

// Prevent accidental exposure in content-script context
if (typeof window !== 'undefined') {
  console.warn('[AI Browse] secure_config loaded in window context — keys are safe as long as this file is not bundled into content_scripts.');
}

export { PROVIDER_CONFIG };
