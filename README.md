# AI Browse — Model Router Browser Extension

Route browser-automation tasks to the optimal model. Choose manually or let the router decide based on cost, speed, reasoning strength, and task type.

## Model Stack

| Priority | Model | Provider | API Base | Best For |
|----------|-------|----------|----------|----------|
| **Primary** | DeepSeek V4-Flash | DeepSeek API | `api.deepseek.com` | Browser automation, DOM reading, multi-step execution, cost-efficient default |
| Fallback 1 | Kimi K2.6 | Moonshot AI | `api.moonshot.ai` | Complex reasoning, large context, long-horizon planning |
| Fallback 2 | Grok Build 0.1 | x.ai | `api.x.ai` | Code-agent tasks, tool workflows, orchestration logic |
| Fast Executor | Groq Llama 3 | Groq API | `api.groq.com` | Extraction, classification, transforms, lightweight page analysis |
| Cheap Backup | Qwen3 Coder | OpenRouter | `openrouter.ai` | Low-cost coding, scraping, overflow work |

## Routing Logic

### Automatic mode
The router picks the model based on **task type**:

- **browse** → DeepSeek V4-Flash (DOM reading, page-state reasoning, multi-step execution)
- **reason** → Kimi K2.6 (complex planning, ambiguous flows, large context)
- **code** → Grok Build 0.1 (selector generation, automation code, tool workflows)
- **extract** → Groq Llama 3 (fast, cheap subtasks — summarization, link extraction, transforms)
- **scrap** → Qwen3 Coder (low-cost coding/scraping backup)

### Escalation rules
- Escalate to next fallback after **2 consecutive failures** on the same task
- **Context >32K tokens** → route to Kimi regardless of task type
- Extract tasks default to Groq for speed — escalate to DeepSeek if quality drops
- DeepSeek stays the default for browser automation loops unless quality degrades

### Behavior rules
- **No Claude models** used anywhere in the stack
- Prefer cheapest model likely to succeed
- Short helper subtasks go to Groq Llama 3 first
- Heavy planning and messy flows go to Kimi
- Code-generation-heavy automation goes to Grok Build

## Manual mode

Override the router and pin any model directly. Useful for:
- Testing a specific model on a task
- Staying on a model that's "in the zone"
- Comparing outputs across models

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   manifest.json                  │
│  Permissions: storage, activeTab, sidePanel      │
│  Hosts: deepseek, moonshot.ai, x.ai, groq, OR    │
└─────────────────────────────────────────────────┘
           │
      ┌────┴────── Service Worker ───────────────┐
      │  src/background.js                        │
      │  - Routes messages popup ↔ panel ↔ API    │
      │  - Handles CHAT_COMPLETION to providers    │
      │  - Opens side panel on extension click     │
      └───────────────────┬───────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
  ┌────────────┐  ┌──────────────┐  ┌───────────┐
  │  popup.html│  │  panel.html  │  │content.js │
  │  popup.js  │  │  panel.js    │  │(injected  │
  │            │  │              │  │ into all  │
  │ Quick      │  │ Full chat UI │  │ pages)    │
  │ route +    │  │ with model   │  │           │
  │ status +   │  │ selector +   │  │ Provides  │
  │ history    │  │ page context │  │ DOM       │
  └────────────┘  └──────────────┘  │ summary   │
          │              │          └───────────┘
          └──────────────┴─────────────────┘
                           │
              ┌────────────▼─────────────┐
              │    model_router.js       │
              │  - Task profile matching │
              │  - Failure escalation    │
              │  - Context-based routing │
              │  - Manual/auto mode      │
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │    secure_config.js      │
              │  - Preloaded API keys    │
              │  (5 provider endpoints)  │
              └──────────────────────────┘
```

## Files

```
AI Browse/
├── manifest.json              # Extension manifest (MV3)
├── icons/
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
└── src/
    ├── secure_config.js       # Preloaded provider API keys
    ├── model_router.js        # Core routing engine
    ├── background.js          # Service worker
    ├── popup.html             # Popup UI
    ├── popup.js               # Popup logic
    ├── panel.html             # Side panel UI
    ├── panel.js               # Side panel chat
    ├── content.js             # Page context provider
    └── styles.css             # All styling
```

## Setup

1. **Edit `src/secure_config.js`** — replace the placeholder API keys with your real keys:
   - DeepSeek (primary)
   - Moonshot AI (Kimi)
   - x.ai (Grok)
   - Groq (Llama 3)
   - OpenRouter (Qwen3 Coder)

2. **Load in Chrome:**
   - Go to `chrome://extensions`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select the `AI Browse` folder

3. **Use:**
   - Click the extension icon to open the popup
   - Click again (or press) to open the side panel
   - Toggle between Auto and Manual routing
   - Select a task type and chat

## Cost Reference

| Model | Cost / 1K tokens | Speed |
|-------|-----------------|-------|
| DeepSeek V4-Flash | $0.00014 | Fast |
| Kimi K2.6 | $0.0008 | Medium |
| Grok Build 0.1 | $0.0005 | Medium |
| Groq Llama 3 | $0.00005 | Very fast |
| Qwen3 Coder (OR) | $0.00004 | Medium |

## License

Built for AI_Factory — Columbia, SC.