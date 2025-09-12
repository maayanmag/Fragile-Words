/**
 * tokenizer.js
 * Lightweight GPT-2 BPE tokenizer loader (runtime fetch) with string token outputs.
 *
 * Loads encoder.json and vocab.bpe (merges) from a public CDN once, builds
 * the BPE ranks map, and exposes:
 *   await ensureTokenizerReady()
 *   tokenizeToDisplayChunks(text) -> Array<string> (string form of GPT‑2 tokens)
 *
 * Intent:
 *  - Provide reasonably accurate GPT‑2 BPE token boundaries.
 *  - Avoid embedding the ~500KB encoder data directly; fetch on demand.
 *  - Fallback gracefully to a simple regex splitter if network fails.
 *
 * NOTE:
 *  - We output the raw token strings (byte decoded), preserving leading spaces.
 *  - Downstream code (ui.js) treats each returned token as a "block".
 */

/**
 * Correct GPT-2 asset base path (previous path 404'ed -> constant failure & fallback):
 * Official OpenAI hosting uses /models/124M/ for encoder.json & vocab.bpe
 * Add simple multi-endpoint fallback list (first that succeeds wins).
 */
const ENDPOINTS = [
  // Primary Azure Blob (official)
  'https://openaipublic.blob.core.windows.net/gpt-2/models/124M',
  // jsDelivr GitHub mirror
  'https://cdn.jsdelivr.net/gh/openai/gpt-2/models/124M',
  // Raw GitHub (adds proper CORS headers)
  'https://raw.githubusercontent.com/openai/gpt-2/master/models/124M'
];

let activeEndpointIndex = 0;
function currentEncoderURL() {
  return ENDPOINTS[activeEndpointIndex] + '/encoder.json';
}
function currentMergesURL() {
  return ENDPOINTS[activeEndpointIndex] + '/vocab.bpe';
}

let encoder = null;         // char -> token id map
let decoder = null;         // token id -> char map
let bpeRanks = null;        // Map of pair -> rank
let cache = new Map();      // BPE cache
let loadPromise = null;
let failed = false;
let mockMode = false; // heuristic tokenization mode (activated if remote assets unreachable)

/**
 * Byte <-> unicode reversible mapping (GPT-2 style)
 */
function bytesToUnicode() {
  const bs = [];
  const cs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  return bs.reduce((obj, b, i) => {
    obj[String.fromCharCode(b)] = String.fromCharCode(cs[i] || b);
    return obj;
  }, {});
}

const byteEncoder = bytesToUnicode();
const byteDecoder = Object.entries(byteEncoder).reduce((o, [k, v]) => {
  o[v] = k;
  return o;
}, {});

// Regex from OpenAI GPT-2 tokenizer
const GPT2_PATTERN = /'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?\d+| ?[^ \r\n\tA-Za-z\d]+|\s+(?!\S)|\s+/g;

/**
 * Fetch and build tokenizer data.
 */
async function loadTokenizer() {
  if (loadPromise) return loadPromise;
  let attempts = 0;
  const maxPerEndpointAttempts = 1;
  const maxEndpoints = ENDPOINTS.length;

  const tryLoad = async () => {
    attempts++;
    try {
      const encURL = currentEncoderURL();
      const mergesURL = currentMergesURL();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const fetchOpts = { signal: controller.signal, mode: 'cors', cache: 'no-store' };
      console.log('[tokenizer] Fetching encoder & merges from', encURL);
      const [encRes, mergesRes] = await Promise.all([
        fetch(encURL, fetchOpts),
        fetch(mergesURL, fetchOpts)
      ]);
      clearTimeout(timeout);
      if (!encRes.ok || !mergesRes.ok) throw new Error('HTTP ' + encRes.status + '/' + mergesRes.status);
      encoder = await encRes.json();
      decoder = Object.entries(encoder).reduce((o, [k, v]) => {
        o[v] = k;
        return o;
      }, {});
      const mergesText = await mergesRes.text();
      const lines = mergesText.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('#'));
      const merges = lines.map(l => l.split(/\s+/));
      bpeRanks = new Map(merges.map((m, i) => [m.join(' '), i]));
      failed = false;
      return true;
    } catch (e) {
      console.warn('[tokenizer] Endpoint failed', ENDPOINTS[activeEndpointIndex], e);
      // Advance endpoint if available
      activeEndpointIndex++;
      if (activeEndpointIndex < maxEndpoints) {
        return tryLoad();
      } else {
        console.warn('[tokenizer] All endpoints failed – switching to heuristic mock mode.');
        // Activate mock mode (pretend "ready" with heuristic segmentation)
        mockMode = true;
        failed = false;
        encoder = {};         // non-null sentinel
        bpeRanks = new Map(); // non-null sentinel
        return false;
      }
    }
  };

  loadPromise = (async () => {
    const ok = await tryLoad();
    return ok;
  })();

  return loadPromise;
}

export async function ensureTokenizerReady() {
  if ((!encoder || !bpeRanks) && !failed) {
    await loadTokenizer();
  } else if (failed) {
    // Retry after failure: reset state & rotate endpoints (already advanced); allow manual retry
    loadPromise = null;
    if (activeEndpointIndex >= ENDPOINTS.length) {
      activeEndpointIndex = 0; // loop endpoints again
    }
    failed = false;
    await loadTokenizer();
  }
}

// Watchdog: if still neither ready nor failed after 10000ms, force fail to unblock UI.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (!tokenizerReady() && !failed) {
      console.warn('[tokenizer] Watchdog timeout -> marking failed (no response)');
      failed = true;
      window.dispatchEvent(new CustomEvent('tokenizer-failed'));
    }
  }, 10000);
}

/**
 * Status helpers so UI can gate submission until true BPE is active.
 */
export function tokenizerReady() {
  return (mockMode || (encoder && bpeRanks)) && !failed;
}
export function tokenizerFailed() {
  return failed;
}
export function tokenizerMode() {
  if (failed) return 'fallback-failed';
  if (mockMode) return 'mock';
  if (tokenizerReady()) return 'bpe';
  return 'loading';
}

/**
 * Get symbol pairs in a word (array of symbols)
 */
function getPairs(word) {
  const pairs = new Set();
  for (let i = 0; i < word.length - 1; i++) {
    pairs.add(word[i] + '\u0000' + word[i + 1]);
  }
  return pairs;
}

/**
 * BPE merge on a token (string)
 */
function bpe(token) {
  if (cache.has(token)) return cache.get(token);
  let word = Array.from(token);
  if (word.length === 1) {
    cache.set(token, word);
    return word;
  }
  let pairs = getPairs(word);

  while (true) {
    if (!pairs.size) break;
    let minPair = null;
    let minRank = Infinity;
    for (const pair of pairs) {
      const [a, b] = pair.split('\u0000');
      const rank = bpeRanks.get(a + ' ' + b);
      if (rank !== undefined && rank < minRank) {
        minRank = rank;
        minPair = [a, b];
      }
    }
    if (!minPair) break;
    const [first, second] = minPair;
    const newWord = [];
    let i = 0;
    while (i < word.length) {
      const j = word.indexOf(first, i);
      if (j === -1) {
        newWord.push(...word.slice(i));
        break;
      }
      newWord.push(...word.slice(i, j));
      if (j < word.length - 1 && word[j + 1] === second) {
        newWord.push(first + second);
        i = j + 2;
      } else {
        newWord.push(word[j]);
        i = j + 1;
      }
    }
    word = newWord;
    if (word.length === 1) break;
    pairs = getPairs(word);
  }
  cache.set(token, word);
  return word;
}

/**
 * Encode one text span (tokenization -> BPE -> ids) returning subword strings.
 */
function encodeFragment(text) {
  const matches = text.match(GPT2_PATTERN) || [];
  const tokens = [];
  for (const m of matches) {
    // Convert bytes -> mapped unicode
    const chars = Array.from(new TextEncoder().encode(m)).map(b => byteEncoder[String.fromCharCode(b)]).join('');
    const bpeTokens = bpe(chars);
    tokens.push(...bpeTokens);
  }
  return tokens;
}

/**
 * Convert internal subword pieces back to displayable strings (reverse byte mapping).
 */
function subwordToDisplay(sw) {
  // sw is a merged symbol; split into characters, decode each via byteDecoder if mapped
  const bytes = [];
  for (const ch of sw) {
    const orig = byteDecoder[ch] || ch;
    bytes.push(orig.charCodeAt(0));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/**
 * Heuristic mock segmentation (activated when all remote loads fail):
 *  - Preserve leading spaces with following fragment
 *  - Split punctuation as separate tokens
 *  - Split long alphabetic runs into pseudo subwords by vowel/consonant boundaries
 */
function mockSegment(text) {
  const out = [];
  const wordRegex = /(\s+|[A-Za-z]+|[\d]+|[^A-Za-z0-9\s])/g;
  const parts = text.match(wordRegex) || [];
  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      // Defer: attach whitespace to next alpha chunk if possible
      out.push(part);
      continue;
    }
    if (/^[A-Za-z]{8,}$/.test(part)) {
      // Split long words heuristically
      let buf = '';
      for (let i = 0; i < part.length; i++) {
        buf += part[i];
        const next = part[i + 1];
        const isBoundary =
          buf.length >= 4 &&
          (
            /[aeiou]$/i.test(buf) && next && /[bcdfghjklmnpqrstvwxyz]/i.test(next)
          );
        if (isBoundary) {
          out.push(buf);
          buf = '';
        }
      }
      if (buf) out.push(buf);
    } else {
      out.push(part);
    }
  }
  // Merge leading spaces with following token where appropriate
  const merged = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (/^\s+$/.test(t) && i < out.length - 1) {
      merged.push(t + out[i + 1]);
      i++;
    } else {
      merged.push(t);
    }
  }
  return merged.filter(t => t.trim().length);
}

/**
 * Public: tokenize text into display strings (GPT-2 tokens or mock heuristic).
 * Falls back to simple regex if still in genuine failed state.
 */
export function tokenizeToDisplayChunks(text) {
  if (!text) return [];
  if (mockMode) {
    return mockSegment(text);
  }
  if (failed || !encoder || !bpeRanks) {
    return (text.match(GPT2_PATTERN) || []).map(t => t);
  }
  const subs = encodeFragment(text);
  return subs.map(sw => subwordToDisplay(sw));
}

/**
 * Convenience: tokenize asynchronously ensuring resources are loaded.
 */
export async function tokenizeAsync(text) {
  await ensureTokenizerReady();
  return tokenizeToDisplayChunks(text);
}

// Expose globally (optional) for debugging
if (typeof window !== 'undefined') {
  window.__gpt2Tokenizer = {
    ensureTokenizerReady,
    tokenizeAsync,
    tokenizerReady,
    tokenizerFailed,
    tokenizerMode
  };
  // Fire an event when ready (async)
  const fireStatus = () => {
    const mode = tokenizerMode();
    if (mode === 'bpe' || mode === 'mock') {
      window.dispatchEvent(new CustomEvent('tokenizer-ready', { detail: { mode } }));
    } else if (tokenizerFailed()) {
      window.dispatchEvent(new CustomEvent('tokenizer-failed'));
    }
  };
  ensureTokenizerReady().then(fireStatus);

  // Provide a manual retry hook
  window.addEventListener('tokenizer-retry', () => {
    ensureTokenizerReady().then(fireStatus);
  });
}
