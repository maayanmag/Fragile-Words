/**
 * utils.js
 * Generic helpers: deterministic RNG, easing, math, layout.
 * All randomness should flow through the seeded RNG for reproducibility.
 */

export const SEED = 1337; // Change for different deterministic runs.

let _rngState = SEED >>> 0;

/**
 * Mulberry32 style deterministic RNG.
 */
export function seedRandom(seed = SEED) {
  _rngState = seed >>> 0;
}

export function rand() {
  // Mulberry32
  _rngState |= 0;
  _rngState = (_rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(min, max) {
  return min + (max - min) * rand();
}

export function randomInt(min, max) {
  return Math.floor(randomRange(min, max + 1));
}

export function choice(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// EASING
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

export function easeOutQuad(t) {
  return t * (2 - t);
}

export function easeInQuad(t) {
  return t * t;
}

export function easeOutCubic(t) {
  const u = t - 1;
  return u * u * u + 1;
}

/**
 * Compute center of mass of an array of Matter bodies.
 * @param {Matter.Body[]} bodies
 * @returns {{x:number,y:number}}
 */
export function computeCOM(bodies) {
  if (!bodies.length) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumM = 0;
  for (const b of bodies) {
    const m = b.mass || 1;
    sumM += m;
    sumX += b.position.x * m;
    sumY += b.position.y * m;
  }
  return {
    x: sumX / sumM,
    y: sumY / sumM
  };
}

/**
 * Debounce utility returning a wrapped function.
 */
export function debounce(fn, delay = 150) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Simple bounding box builder from letter layout.
 */
export function aggregateBounds(letterRects) {
  if (!letterRects.length) return { x:0, y:0, w:0, h:0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of letterRects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Deterministic fragment pattern generator: splits a rect into pseudo-random triangles.
 * Returns array of polygons, each polygon = [{x,y}, ...]
 */
export function fragmentRectangle(x, y, w, h, charCodeSeed, maxPieces = 8) {
  // Use a temporary seeded RNG variant using charCodeSeed + index
  const prevState = _rngState;
  seedRandom((charCodeSeed * 1315423911) ^ (w * 92821) ^ (h * 48271));
  const pieces = clamp(maxPieces, 3, 20);
  // Create internal jitter points
  const pts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h }
  ];
  const extra = pieces - 4;
  for (let i = 0; i < extra; i++) {
    pts.push({
      x: randomRange(w * 0.15, w * 0.85),
      y: randomRange(h * 0.15, h * 0.85)
    });
  }
  // Triangulate by fan from centroid for simplicity
  const cx = w / 2;
  const cy = h / 2;
  shuffle(pts); // random order for variety
  const result = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a === b) continue;
    result.push([
      { x: x + cx, y: y + cy },
      { x: x + a.x, y: y + a.y },
      { x: x + b.x, y: y + b.y }
    ]);
  }
  seedRandom(prevState); // restore RNG state
  return result;
}

/**
 * Quick polygon area (signed).
 */
export function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area / 2;
}

/**
 * Determine if a string is a "valid" word we accept.
 */
export function sanitizeWord(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^A-Za-z]/g, "");
  if (!cleaned) return null;
  return cleaned.length > 12 ? cleaned.slice(0, 12) : cleaned;
}

/**
 * Sanitize a full sentence into an array of word tokens.
 * - Splits on any non-letter (punctuation treated as separator)
 * - Filters empty tokens
 * - Caps each token length to 12 characters
 * - Returns array of words (may be empty)
 */
export function sanitizeSentence(raw) {
  if (!raw) return [];
  const replaced = raw.replace(/[^A-Za-z]+/g, " ").trim();
  if (!replaced) return [];
  const parts = replaced.split(/\s+/);
  const words = [];
  for (const p of parts) {
    if (!p) continue;
    const w = p.length > 12 ? p.slice(0, 12) : p;
    words.push(w);
  }
  return words;
}

/**
 * Sum of heights of bodies (approx) for heuristics.
 */
export function stackHeight(bodies) {
  if (!bodies.length) return 0;
  let maxY = -Infinity;
  let minY = Infinity;
  for (const b of bodies) {
    const y = b.position.y;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return maxY - minY;
}

/**
 * Simple moving average helper.
 */
export class MovingAverage {
  constructor(size = 30) {
    this.size = size;
    this.values = [];
    this.sum = 0;
  }
  push(v) {
    this.values.push(v);
    this.sum += v;
    if (this.values.length > this.size) {
      this.sum -= this.values.shift();
    }
  }
  value() {
    if (!this.values.length) return 0;
    return this.sum / this.values.length;
  }
}
