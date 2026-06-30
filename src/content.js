/**
 * content.js — Page Context Provider
 *
 * Injected into every page to provide DOM summaries, selected text,
 * and page metadata to the side panel and popup.
 *
 * Runs at document_end to ensure the DOM is available.
 */

// ─── Listen for requests from popup / panel ──────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_CONTEXT') {
    sendResponse(getPageContext());
  }
});

// ─── Page Context Builder ────────────────────────────────────────────────

function getPageContext() {
  const doc = document;

  // Basic metadata
  const context = {
    url: location.href,
    title: doc.title,
    referrer: doc.referrer,
    readyState: doc.readyState,
    contentType: doc.contentType || '',
  };

  // Selected text
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    context.selectedText = selection.toString().trim().slice(0, 10000);
  }

  // DOM summary — compressed representation of visible content
  context.domSummary = buildDomSummary(doc.body, {
    maxLinks: 20,
    maxHeadings: 10,
    maxParagraphs: 15,
    maxFormFields: 10,
  });

  // Meta tags
  const metaTags = doc.querySelectorAll('meta[name], meta[property]');
  const meta = {};
  metaTags.forEach((el) => {
    const name = el.getAttribute('name') || el.getAttribute('property');
    const content = el.getAttribute('content');
    if (name && content) meta[name] = content.slice(0, 200);
    if (Object.keys(meta).length >= 20) return; // limit
  });
  context.meta = meta;

  return context;
}

// ─── DOM Summary Generator ───────────────────────────────────────────────

function buildDomSummary(root, opts = {}) {
  if (!root) return '(no body)';

  const parts = [];

  // Page type heuristic
  const allText = root.innerText || '';
  const wordCount = allText.split(/\s+/).filter(Boolean).length;
  parts.push(`Page length: ~${wordCount} words.`);

  // Links
  const links = root.querySelectorAll('a[href]');
  const visibleLinks = [];
  links.forEach((a) => {
    if (a.offsetParent !== null && a.innerText.trim()) {
      visibleLinks.push({ text: a.innerText.trim().slice(0, 80), href: a.href });
    }
  });
  if (visibleLinks.length > 0) {
    const maxLinks = opts.maxLinks || 20;
    const linkList = visibleLinks.slice(0, maxLinks);
    parts.push(`Links (${visibleLinks.length} total, showing ${linkList.length}):`);
    linkList.forEach((l, i) => parts.push(`  [${i + 1}] "${l.text}" → ${l.href}`));
    if (visibleLinks.length > maxLinks) parts.push(`  ... and ${visibleLinks.length - maxLinks} more.`);
  }

  // Headings
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length > 0) {
    const maxHeadings = opts.maxHeadings || 10;
    const headingList = Array.from(headings).slice(0, maxHeadings);
    parts.push(`Headings (${headings.length} total, showing ${headingList.length}):`);
    headingList.forEach((h) => parts.push(`  ${h.tagName}: "${h.innerText.trim().slice(0, 100)}"`));
    if (headings.length > maxHeadings) parts.push(`  ... and ${headings.length - maxHeadings} more.`);
  }

  // Paragraphs (first few significant ones)
  const paragraphs = root.querySelectorAll('p, li, blockquote');
  if (paragraphs.length > 0) {
    const maxPars = opts.maxParagraphs || 15;
    let count = 0;
    for (const p of paragraphs) {
      const text = p.innerText.trim();
      if (text.length > 40) {
        parts.push(`  ¶: "${text.slice(0, 200)}"`);
        count++;
        if (count >= maxPars) break;
      }
    }
  }

  // Form fields (inputs, selects, textareas)
  const fields = root.querySelectorAll('input:not([type="hidden"]), select, textarea');
  if (fields.length > 0) {
    const maxFields = opts.maxFormFields || 10;
    const fieldList = Array.from(fields).slice(0, maxFields);
    parts.push(`Form fields (${fields.length} total, showing ${fieldList.length}):`);
    fieldList.forEach((f, i) => {
      const name = f.getAttribute('name') || f.getAttribute('id') || f.className || '(unnamed)';
      const type = f.type || f.tagName;
      const placeholder = f.getAttribute('placeholder') || '';
      const val = f.value ? ` = "${f.value.slice(0, 40)}"` : '';
      parts.push(`  [${i + 1}] <${type} name="${name}"${placeholder ? ` placeholder="${placeholder}"` : ''}>${val}`);
    });
  }

  // Buttons
  const buttons = root.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
  if (buttons.length > 0 && buttons.length < 50) {
    const btnTexts = [];
    buttons.forEach((b) => {
      const t = (b.innerText || b.value || '').trim();
      if (t) btnTexts.push(t.slice(0, 40));
    });
    if (btnTexts.length > 0) {
      parts.push(`Buttons (${btnTexts.length}): ${btnTexts.slice(0, 15).join(', ')}${btnTexts.length > 15 ? '...' : ''}`);
    }
  }

  return parts.join('\n');
}

// ─── Signal ready ────────────────────────────────────────────────────────

console.log('[AI Browse] Content script loaded, page context provider ready.');
