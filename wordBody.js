/**
 * wordBody.js
 * Responsible for constructing a Matter compound body representing a word.
 * Each letter is approximated as a rectangle based on p5 text metrics.
 * Rendering of the actual glyph is done in sketch.js (for fidelity);
 * physics uses these rectangular hulls.
 *
 * Exports:
 *  makeWordEntry(p, word, x, y, opts?)
 *
 * Returned entry:
 *  {
 *    word,
 *    body,           // Matter.Body (compound)
 *    letterRects,    // [{x,y,w,h}] relative layout (top-left origin at 0,0 pre-centering)
 *    lettersCount,
 *    width,
 *    height
 *  }
 */

import { rand } from './utils.js';

const {
  Bodies,
  Body,
  Composite,
  Vector
} = Matter;

export const WORD_PHYSICS_DEFAULTS = {
  letterHeight: 34,
  letterPaddingX: 4,
  letterPaddingY: 6,
  density: 0.0020,        // slightly heavier for more stable stacking
  restitution: 0.05,      // lower bounce to reduce jitter
  friction: 0.85,         // higher friction to reduce sliding / sudden shifts
  frictionStatic: 1.0,    // stronger static friction
  frictionAir: 0.02,      // mild air damping to calm motion
  chamfer: 2
};

/**
 * Measures the word using p5 textWidth for each letter to build rectangles.
 * We treat baseline with an ascent approximation (letterHeight).
 * @param {p5} p
 * @param {string} word
 * @param {object} cfg
 * @returns {{rects:Array, width:number, height:number}}
 */
function layoutLetters(p, word, cfg) {
  const rects = [];
  let cursorX = 0;
  const h = cfg.letterHeight;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const w = Math.max(8, p.textWidth(ch)) + cfg.letterPaddingX;
    rects.push({
      char: ch,
      x: cursorX,
      y: -h * 0.5, // center letters vertically around 0
      w,
      h
    });
    cursorX += w;
  }
  const totalW = cursorX;
  return { rects, width: totalW, height: h };
}

/**
 * Build a compound body from letter rects.
 */
function buildCompoundBody(rects, opts) {
  const parts = [];
  for (const r of rects) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const part = Bodies.rectangle(cx, cy, r.w, r.h, {
      restitution: opts.restitution,
      friction: opts.friction,
      frictionStatic: opts.frictionStatic,
      density: opts.density,
      chamfer: { radius: opts.chamfer }
    });
    parts.push(part);
  }
  // Combine into one body
  const compound = Body.create({
    parts,
    restitution: opts.restitution,
    friction: opts.friction,
    frictionStatic: opts.frictionStatic,
    density: opts.density,
    label: 'word'
  });
  return compound;
}

/**
 * Create a word entry ready to be added to physics:
 *
 *  makeWordEntry(p, "Hello", 400, -50)
 */
export function makeWordEntry(p, word, x, y, overrides = {}) {
  const cfg = { ...WORD_PHYSICS_DEFAULTS, ...overrides };

  // Ensure p.textSize matches desired height heuristic
  // We approximate letter height by setting textSize slightly less to account for ascender/descender.
  p.push();
  p.textFont('Helvetica, Arial, sans-serif');
  p.textSize(cfg.letterHeight * 0.78);
  const { rects, width, height } = layoutLetters(p, word, cfg);
  p.pop();

  // Center layout: shift rect set so center of mass near (0,0)
  const centerX = width / 2;
  // Already vertically centered around 0
  for (const r of rects) {
    r.x -= centerX;
  }

  const body = buildCompoundBody(rects, cfg);

  Body.setPosition(body, { x, y });
  Body.setAngle(body, (rand() - 0.5) * 0.05); // reduced initial tilt for stability

  return {
    word,
    body,
    letterRects: rects.map(r => ({ ...r })), // shallow copy
    lettersCount: rects.length,
    width,
    height,
    letterHeight: cfg.letterHeight
  };
}
