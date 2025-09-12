/**
 * sketch.js
 * ---------------------------------------------------------------------------
 * Fragile Words (p5.js + Matter.js)
 *
 * Flow:
 *  - User types a full sentence (human semantic unit) which spawns as ONE falling body.
 *  - On FIRST physical impact (ground or existing stack) that body splits into GPT‑2 BPE tokens
 *    revealing the model’s internal sub‑word segmentation.
 *  - Tokens stack to form a precarious vertical structure (metaphor: human meaning tower vs. machine sequence).
 *  - Instability heuristics (physics.js) trigger a collapse state; gravity is gently reduced
 *    for calmer settling. Tokens now just drift/settle (no further breakup).
 *  - Font size slider adjusts future sentence/token geometry.
 *  - “Start again” resets physics, RNG, and clears state (deterministic seed re-applied).
 *
 * Key Tunables:
 *  - Physics thresholds & caps: physics.js (PHYS)
 *  - Body geometry / material: wordBody.js (WORD_PHYSICS_DEFAULTS + letterHeight override)
 *  - Collapse gravity scaling: physics.js (markCollapsedNoShatter)
 *  - RNG: utils.js (seedRandom, rand)
 *
 * Architecture:
 *  - Rendering + lifecycle: this file
 *  - Physics + instability detection: physics.js
 *  - Compound letter-rect construction: wordBody.js
 *  - UI + font slider + tokenizer trigger: ui.js + tokenizer.js
 *
 * Rendering:
 *  - Black background; white rounded rectangles with black glyphs.
 *
 * Concept:
 *  - Human: stacking semantic blocks (sentences → contextual structure).
 *  - Machine: sequence of opaque sub‑word tokens revealed only on impact with context.
 *
 * ---------------------------------------------------------------------------
 */

import {
  initPhysics,
  resetPhysics,
  stepPhysics,
  addWordEntry,
  getWordBodies,
  checkAndFlagCollapse,
  handleResize,
  isCollapsed,
  markCollapsedNoShatter,
  removeWordEntry,
  setSentenceImpactCallback,
  PHYS,
  floorBody
} from './physics.js';

import { makeWordEntry } from './wordBody.js';
/* Fragments pipeline removed (no letter/token breakup after collapse) */
/* Crane removed */
import { initUI, focusInput, getFontSize } from './ui.js';
import { seedRandom, rand } from './utils.js';

 // Word queue control (FIFO)
const wordQueue = [];

// Canvas reference
let p5Instance = null;
let lastMillis = 0;

/**
 * Enqueue a sanitized word from UI.
 */
function enqueueWord(payload) {
  // payload can be:
  //  - string (legacy single token/word)
  //  - { type:'sentence', sentence:string, tokens:string[] }
  wordQueue.push(payload);
}

/**
 * Spawn the next word from queue if conditions allow.
 * We let multiple pending words enter; crane picks them later when stable.
 */
function maybeSpawnWord(p) {
  if (!wordQueue.length) return;
  const item = wordQueue.shift();
  const x = p.width * 0.5;
  const y = -50;
  const fontSize = getFontSize();

  if (typeof item === 'string') {
    const entry = makeWordEntry(p, item, x, y, { letterHeight: fontSize });
    addWordEntry(entry);
    return;
  }

  if (item && item.type === 'sentence' && Array.isArray(item.tokens) && item.tokens.length) {
    // Create a parent body representing the entire raw sentence (joined tokens display)
    const display = item.sentence || item.tokens.join('');
    const parentEntry = makeWordEntry(p, display, x, y, { letterHeight: fontSize });
    parentEntry.spawnMillis = p.millis();
    parentEntry.sentenceTokens = item.tokens.slice(); // store tokens for impact split
    parentEntry.isSentenceParent = true;
    parentEntry.midSplitDone = false;
    parentEntry.parentLetterHeight = fontSize;
    addWordEntry(parentEntry);
    return;
  }
}

/**
 * Collapse handling: perform shatter only once.
 */
let collapseActivated = false;
function activateCollapse() {
  if (collapseActivated) return;
  collapseActivated = true;
  // Mark collapse; soften gravity (tokens remain intact).
  markCollapsedNoShatter();
}

/**
 * Full reset invoked by UI.
 */
function fullReset(p) {
  collapseActivated = false;
  wordQueue.length = 0;
  seedRandom(); // reset RNG to seed
  resetPhysics(p.width, p.height);
}

/**
 * DRAW WORDS
 * Render each word body by iterating letter rects in its local coordinates.
 */
function drawWords(p) {
  const words = getWordBodies();
  p.push();
  for (const entry of words) {
    const b = entry.body;
    p.push();
    p.translate(b.position.x, b.position.y);
    p.rotate(b.angle);
    p.textAlign(p.CENTER, p.CENTER);
    for (const r of entry.letterRects) {
      // Subtle stroked white block (spec: white filled shape with 1px stroke)
      p.stroke(255);
      p.strokeWeight(1);
      p.fill(255);
      p.rectMode(p.CORNER);
      p.rect(r.x, r.y, r.w, r.h, 3);
      // Letter glyph (slightly smaller) to emphasize word meaning
      p.noStroke();
      p.fill(0); // invert letter for contrast inside white block
      p.textSize(r.h * 0.6);
      p.text(r.char, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
    p.pop();
  }
  p.pop();
}

/* Fragment drawing removed (letters handle breakup) */

/**
 * Impact-based sentence parent -> token split (refined).
 *
 * Goals:
 *  - Delay actual split by 1 frame after first collision to let parent settle into contact,
 *    reducing the visual "jump".
 *  - Spawn token bodies centered around the original parent body's center (symmetric layout)
 *    instead of expanding only to the right, avoiding lateral impulse.
 *  - Inherit parent linear + angular velocity and angle for continuity.
 */
const pendingSplits = [];

function scheduleSentenceSplit(entry, p) {
  if (!entry || entry.midSplitDone || entry.splitScheduled) return;
  entry.splitScheduled = true;
  // Capture kinematic + pose state at scheduling time
  const b = entry.body;
  entry._capturedState = {
    x: b.position.x,
    y: b.position.y,
    angle: b.angle,
    vx: b.velocity.x,
    vy: b.velocity.y,
    av: b.angularVelocity
  };
  entry._delayFrames = 1; // one-frame delay
  pendingSplits.push(entry);
}

function processPendingSplits(p) {
  if (!pendingSplits.length) return;
  for (let i = pendingSplits.length - 1; i >= 0; i--) {
    const entry = pendingSplits[i];
    if (entry.midSplitDone) {
      pendingSplits.splice(i, 1);
      continue;
    }
    if (entry._delayFrames > 0) {
      entry._delayFrames--;
      continue;
    }
    // Perform the actual split now.
    const tokens = entry.sentenceTokens || [];
    entry.midSplitDone = true;
    pendingSplits.splice(i, 1);

    if (!tokens.length) continue;

    const parentState = entry._capturedState;
    const lh = entry.parentLetterHeight || entry.letterHeight || 34;

    // Remove parent AFTER delay so physics remains coherent during waiting frame
    removeWordEntry(entry);

    // First pass: create token entries all at the parent center so we can measure widths
    const gap = 4;
    const created = [];
    let totalWidth = 0;
    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti];
      const tokenEntry = makeWordEntry(p, token, parentState.x, parentState.y, { letterHeight: lh });
      tokenEntry.isToken = true;
      created.push(tokenEntry);
      totalWidth += tokenEntry.width;
      if (ti < tokens.length - 1) totalWidth += gap;
    }

    // Centered layout: distribute tokens symmetrically
    let cursor = -totalWidth / 2;
    for (const tokenEntry of created) {
      const centerX = cursor + tokenEntry.width / 2;
      // Minimal vertical jitter (±1px) to avoid z-fighting look
      const yJitter = (rand() - 0.5) * 2;
      // Reposition & orient
      tokenEntry.body.angle = parentState.angle; // set directly before adding
      Matter.Body.setPosition(tokenEntry.body, {
        x: parentState.x + centerX,
        y: parentState.y + yJitter
      });
      Matter.Body.setAngle(tokenEntry.body, parentState.angle);
      Matter.Body.setVelocity(tokenEntry.body, { x: parentState.vx, y: parentState.vy });
      Matter.Body.setAngularVelocity(tokenEntry.body, parentState.av);
      addWordEntry(tokenEntry);
      cursor += tokenEntry.width + gap;
    }
  }
}

/* Removed fallbackEnsureSentenceSplits: splitting now ONLY occurs on actual collision events (floor, wall, or another word body) to honor user-specified triggers. */

// Instantiate p5 in instance mode
new p5(p => {
  p5Instance = p;

  p.setup = function() {
    p.createCanvas(window.innerWidth, window.innerHeight);
    p.pixelDensity(1);
    p.textFont('Helvetica, Arial, sans-serif');
    seedRandom();
    initPhysics(p.width, p.height);
    // Register impact callback for tokenization
    setSentenceImpactCallback(entry => {
      scheduleSentenceSplit(entry, p);
    });
    // Crane removed

    initUI({
      onSubmit: enqueueWord,
      onReset: () => fullReset(p)
    });

    focusInput();
    lastMillis = p.millis();
  };

  p.windowResized = function() {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    handleResize(p.width, p.height);
    // Crane removed
  };

  p.draw = function() {
    const now = p.millis();
    const dt = now - lastMillis;
    lastMillis = now;

    p.background(0);

    // Spawn pending words (allowed even after collapse; new words auto-split if collapsed)
    maybeSpawnWord(p);

    // Crane removed

    // Physics step
    stepPhysics(dt);

    // Process any delayed splits AFTER physics step, BEFORE rendering (only collision-triggered)
    processPendingSplits(p);

    // Impact-based token split handled by physics collision callback (no mid-fall check)

    // Collapse detection
    if (!isCollapsed()) {
      const justCollapsed = checkAndFlagCollapse();
      if (justCollapsed) {
        activateCollapse();
      }
    }

    // Draw order: words
    drawWords(p);
  };
});
