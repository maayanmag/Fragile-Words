/**
 * ui.js
 * Handles DOM input, font size control, reset button, and tokenizer readiness gating.
 *
 * Public API:
 *  initUI({ onSubmit(payload), onReset() })
 *  focusInput()
 *  getFontSize()
 *
 * Sentence input:
 *  - Tokenized with GPT‑2 BPE (tokenizer.js). We now HARD‑GATE submission until the real
 *    tokenizer is fully loaded to avoid fallback whole-word blocks the user reported.
 *  - We enqueue ONE parent sentence body containing the original sentence + its token list.
 *  - Actual physical split into tokens happens ONLY on first collision (floor or another word).
 *
 * Collapse:
 *  - Gravity softens; no further breakup (letter disassembly removed).
 *
 * Tokenizer Gating:
 *  - Input disabled while tokenizer state == loading.
 *  - On success: enable input, status shows "Tokenizer ready (GPT‑2 BPE)".
 *  - On failure: enable input but clearly marks fallback mode (regex segmentation).
 */

import { sanitizeSentence } from './utils.js';
import {
  tokenizeAsync,
  tokenizerReady,
  tokenizerFailed,
  tokenizerMode
} from './tokenizer.js';

let inputEl = null;
let resetBtn = null;
let fontSlider = null;
let fontValueEl = null;
let statusEl = null;

let submitHandler = null;
let resetHandler = null;

let currentFontSize = 34; // default

function updateTokenizerStatus() {
  if (!statusEl) return;
  const mode = tokenizerMode();
  if (mode === 'loading') {
    statusEl.textContent = 'Loading GPT‑2 tokenizer…';
    statusEl.dataset.mode = 'loading';
    statusEl.title = 'Fetching encoder & merges…';
  } else if (mode === 'bpe') {
    statusEl.textContent = 'Tokenizer ready (GPT‑2 BPE)';
    statusEl.dataset.mode = 'ready';
    statusEl.title = 'Subword segmentation active';
  } else if (mode === 'mock') {
    statusEl.textContent = 'Tokenizer mock mode (heuristic subwords)';
    statusEl.dataset.mode = 'ready';
    statusEl.title = 'Remote assets unavailable – using heuristic segmentation';
  } else if (mode === 'fallback-failed') {
    statusEl.textContent = 'Tokenizer failed – click to retry';
    statusEl.dataset.mode = 'failed';
    statusEl.title = 'Network failed; click to attempt reload';
  }
  // Pointer interaction only when failed (retry)
  if (mode === 'fallback-failed') {
    statusEl.style.pointerEvents = 'auto';
  } else {
    statusEl.style.pointerEvents = 'none';
  }
  if (inputEl) {
    if (mode === 'loading') {
      inputEl.disabled = true;
      inputEl.placeholder = 'Loading tokenizer…';
    } else {
      inputEl.disabled = false;
      inputEl.placeholder = 'Type a sentence and press Enter…';
    }
  }
}

export function initUI({ onSubmit, onReset }) {
  inputEl = document.getElementById('wordInput');
  resetBtn = document.getElementById('resetBtn');
  fontSlider = document.getElementById('fontSizeSlider');
  fontValueEl = document.getElementById('fontSizeValue');
  statusEl = document.getElementById('tokenizerStatus');

  submitHandler = onSubmit;
  resetHandler = onReset;

  updateTokenizerStatus();
  // Retry handler (only meaningful if failure)
  if (statusEl) {
    statusEl.addEventListener('click', () => {
      if (tokenizerFailed()) {
        statusEl.textContent = 'Retrying tokenizer…';
        statusEl.dataset.mode = 'loading';
        statusEl.style.pointerEvents = 'none';
        window.dispatchEvent(new Event('tokenizer-retry'));
      }
    });
  }

  // Listen for tokenizer readiness events fired by tokenizer.js
  window.addEventListener('tokenizer-ready', () => {
    updateTokenizerStatus();
  });
  window.addEventListener('tokenizer-failed', () => {
    updateTokenizerStatus();
  });

  if (inputEl) {
    inputEl.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        // HARD GATE: If tokenizer not ready AND not failed, ignore (avoid fallback)
        if (!tokenizerReady() && !tokenizerFailed()) {
          // brief visual pulse
            statusEl && (statusEl.textContent = 'Still loading tokenizer…');
          return;
        }
        const raw = inputEl.value;
        if (!raw || !raw.trim()) {
          inputEl.value = '';
          return;
        }
        let tokens = [];
        try {
          tokens = await tokenizeAsync(raw);
        } catch (err) {
          // Only fallback if tokenizer actually failed (network)
          if (tokenizerFailed()) {
            tokens = sanitizeSentence(raw);
          } else {
            // If not failed but some transient issue, abort submission
            statusEl && (statusEl.textContent = 'Tokenization error; try again.');
            return;
          }
        }
        // Filter: keep tokens that produce some non-whitespace glyph when trimmed
        const filtered = tokens.filter(t => t && t.trim().length);
        if (filtered.length) {
          submitHandler && submitHandler({
            type: 'sentence',
            sentence: raw,
            tokens: filtered
          });
        }
        inputEl.value = '';
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetHandler && resetHandler();
      focusInput();
    });
  }

  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const v = parseInt(fontSlider.value, 10);
      if (!isNaN(v)) {
        currentFontSize = v;
        if (fontValueEl) fontValueEl.textContent = String(v);
      }
    });
  }
}

export function getFontSize() {
  return currentFontSize;
}

export function focusInput() {
  if (inputEl && !inputEl.disabled) inputEl.focus();
}
