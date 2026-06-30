/**
 * onboarding.js — First-run setup wizard with discovery trigger
 */

let currentStep = 1;
const TOTAL_STEPS = 3;

function showStep(step) {
  document.querySelectorAll('.step-panel').forEach(el => el.classList.remove('active'));
  document.querySelector(`.step-panel[data-step="${step}"]`).classList.add('active');
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    const idx = i + 1;
    if (idx === step) dot.classList.add('active');
    else if (idx < step) dot.classList.add('done');
  });
  currentStep = step;
}

window.nextStep = function () {
  if (currentStep < TOTAL_STEPS) showStep(currentStep + 1);
};

window.prevStep = function () {
  if (currentStep > 1) showStep(currentStep - 1);
};

window.skipKeys = function () {
  showStep(3);
  renderModelPreview({});
};

window.saveKeys = async function () {
  const keys = {
    openrouter: document.getElementById('key-openrouter').value.trim(),
    deepseek: document.getElementById('key-deepseek').value.trim(),
    groq: document.getElementById('key-groq').value.trim(),
    moonshot: document.getElementById('key-moonshot').value.trim(),
    xai: document.getElementById('key-xai').value.trim(),
  };

  const provided = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(keys)) {
    if (v) { provided[k] = v; hasAny = true; }
  }

  if (!hasAny) {
    document.getElementById('key-error').style.display = 'block';
    return;
  }
  document.getElementById('key-error').style.display = 'none';

  await chrome.storage.sync.set({ aiBrowseApiKeys: provided });
  await chrome.storage.sync.set({ aiBrowseSetupDone: true });

  showStep(3);
  renderModelPreview(provided);
};

window.finishSetup = async function () {
  await chrome.runtime.sendMessage({ type: 'SETUP_COMPLETE' });
  await chrome.runtime.sendMessage({ type: 'DISCOVER_MODELS' });
  chrome.sidePanel.open();
  window.close();
};

function renderModelPreview(keys) {
  const container = document.getElementById('model-preview');
  const models = [
    { name: 'DeepSeek V4-Flash', key: 'deepseek', cost: '$0.14/M', speed: 'fast', browseStars: 5 },
    { name: 'Kimi K2.6', key: 'moonshot', cost: '$0.80/M', speed: 'medium', browseStars: 4 },
    { name: 'Grok Build 0.1', key: 'xai', cost: '$0.50/M', speed: 'medium', browseStars: 3 },
    { name: 'Groq Llama 3', key: 'groq', cost: '$0.05/M', speed: 'very-fast', browseStars: 2 },
    { name: 'Qwen3 Coder (OpenRouter)', key: 'openrouter', cost: '$0.04/M', speed: 'medium', browseStars: 2 },
  ];

  container.innerHTML = models.map(m => {
    const configured = !!keys[m.key];
    const stars = '★'.repeat(m.browseStars) + '☆'.repeat(5 - m.browseStars);
    return `
      <div class="model-row">
        <span class="name">${m.name}</span>
        <span class="cost">${m.cost}</span>
        <span class="status ${configured ? 'configured' : 'missing'}">
          ${configured ? '✓ Configured' : '— No key'}
        </span>
      </div>
      <div style="font-size:11px; color:#8b949e; margin-bottom:4px;">
        Browser automation: ${stars}
      </div>
    `;
  }).join('');
}

(async function init() {
  const { aiBrowseSetupDone } = await chrome.storage.sync.get('aiBrowseSetupDone');
  if (aiBrowseSetupDone) {
    const { aiBrowseApiKeys } = await chrome.storage.sync.get('aiBrowseApiKeys');
    showStep(3);
    renderModelPreview(aiBrowseApiKeys || {});
  }
})();
