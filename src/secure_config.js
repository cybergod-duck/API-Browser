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
    apiKey: 'YOUR_DEEPSEEK_API_KEY',         // DeepSeek V4-Flash
    defaultModel: 'deepseek-chat',
  },
  moonshot: {
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKey: 'YOUR_MOONSHOT_API_KEY',         // Kimi K2.6
    defaultModel: 'moonshot-v1-auto',        // Replace with actual Kimi K2.6 model name from Moonshot API
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    apiKey: 'YOUR_XAI_API_KEY',              // Grok Build 0.1
    defaultModel: 'grok-build',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: 'YOUR_GROQ_API_KEY',             // Groq Llama 3
    defaultModel: 'llama3-8b-8192',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'YOUR_OPENROUTER_API_KEY',       // Qwen3 Coder — replace with your key
    defaultModel: 'qwen/qwen3-coder',
  },
};

// Prevent accidental exposure in content-script context
if (typeof window !== 'undefined') {
  console.warn('[AI Browse] secure_config loaded in window context — keys are safe as long as this file is not bundled into content_scripts.');
}

export { PROVIDER_CONFIG };