/**
 * physics.js
 * Core physics management for Fargile Words (falling sentence/token stack).
 *
 * Responsibilities:
 *  - Create Matter.js engine/world and static boundaries (floor + side walls).
 *  - Manage collection of active sentence/token entries.
 *  - Provide heuristics to decide when the tower is "unstable" and trigger collapse.
 *  - On collapse: no disassembly — tokens remain intact; gravity is softened to calm motion.
 *  - First qualifying impact schedules a one-frame delayed token split (actual split processed in sketch.js to reduce bounce artifacts).
 *
 * Removed / Legacy (not used in current mode):
 *  - Crane pickup/toss system (crane.js retained for archive).
 *  - Fragment shatter pipeline (fragments.js) and letter-level breakup logic.
 *  - Constraint helpers.
 *
 * Exposed API:
 *  initPhysics(w,h)
 *  resetPhysics(w,h)
 *  stepPhysics(dtMillis)
 *  addWordEntry(entry)
 *  getWordBodies()
 *  checkAndFlagCollapse()
 *  handleResize(w,h)
 *  isCollapsed()
 *  markCollapsedNoShatter()  -> softens gravity on collapse (tokens retained)
 *
 * Data Structures:
 *  wordEntries: Array<{
 *    word, body (Matter.Body), letterRects:[{char,x,y,w,h}], lettersCount, width, height, _split?
 *  }>
 *
 * Determinism: All randomness uses utils.rand() (seeded in sketch.js).
 */

import { computeCOM, stackHeight, clamp, rand } from './utils.js';

const { Engine, World, Bodies, Body, Events } = Matter;

// Tunable physics constants surfaced here
export const PHYS = {
  GRAVITY_Y: 0.95,
  FLOOR_THICKNESS: 60,
  SIDE_WALL_THICKNESS: 80,
  POOL_DAMP_Y: 0.35,
  POOL_REGION: 120,
  MAX_WORDS: 25,
  COLLAPSE_OFFSET_RATIO: 0.25,
  MIN_HEIGHT_FOR_OFFSET_CHECK: 160,
  VELOCITY_WAKE_THRESHOLD: 2.4,
  ANGULAR_WAKE_THRESHOLD: 1.2,
  WAKE_FRAMES_THRESHOLD: 40,
  COLLAPSE_GRAVITY_SCALE: 0.7,
  GROUND_COLLAPSE_COUNT: 3,       // Need >=3 grounded (stable) tokens to consider early collapse
  GROUND_Y_MARGIN: 60,            // Margin above floor to treat as near ground
  GROUND_STABLE_LIN_VEL: 0.5,     // Max linear velocity magnitude to count as grounded
  GROUND_STABLE_ANG_VEL: 0.4,     // Max angular velocity to count as grounded
  EARLY_COUNT_COLLAPSE: 9999      // Disabled (very high threshold so count rule does not trigger)
};

export let engine = null;
export let world = null;
export let floorBody = null;
export let leftWall = null;
export let rightWall = null;

// Collections
export const wordEntries = []; // { word, body, letterRects, lettersCount }
/* Legacy removals: fragmentEntries & activeConstraints no longer needed */

// Internal counters / state
let wakeFrameCounter = 0;
let canvasWidth = 0;
let canvasHeight = 0;
let collapsed = false;

export function isCollapsed() {
  return collapsed;
}

/**
 * Initialize or re-initialize the physics world.
 */
export function initPhysics(w, h) {
  canvasWidth = w;
  canvasHeight = h;
  engine = Engine.create();
  world = engine.world;
  engine.gravity.y = PHYS.GRAVITY_Y;

  // Clear arrays (safety if re-init)
  wordEntries.length = 0;
  collapsed = false;

  // Floor + side walls
  floorBody = Bodies.rectangle(
    w / 2,
    h - PHYS.FLOOR_THICKNESS / 2,
    w,
    PHYS.FLOOR_THICKNESS,
    {
      isStatic: true,
      friction: 1,
      restitution: 0,
      label: 'floor'
    }
  );

  leftWall = Bodies.rectangle(
    -PHYS.SIDE_WALL_THICKNESS / 2,
    h / 2,
    PHYS.SIDE_WALL_THICKNESS,
    h,
    { isStatic: true, label: 'wall-left' }
  );

  rightWall = Bodies.rectangle(
    w + PHYS.SIDE_WALL_THICKNESS / 2,
    h / 2,
    PHYS.SIDE_WALL_THICKNESS,
    h,
    { isStatic: true, label: 'wall-right' }
  );

  World.add(world, [floorBody, leftWall, rightWall]);

  // Collision listener: detect first qualifying impact and schedule deferred (one-frame) token split
  Events.on(engine, 'collisionStart', evt => {
    if (!sentenceImpactCallback) return;
    for (const pair of evt.pairs) {
      const bodies = [pair.bodyA, pair.bodyB];
      for (let i = 0; i < 2; i++) {
        const a = bodies[i];
        const b = bodies[1 - i];
        // Resolve entry via direct reference (compound part or parent), fallback to search
        const entryA =
          a.entryRef ||
          (a.parent && a.parent.entryRef) ||
          findWordEntryByBody(a) ||
          (a.parent && findWordEntryByBody(a.parent));
        if (entryA && entryA.isSentenceParent && !entryA.midSplitDone) {
          // Split ONLY when:
          //  - Impact with floor (true "hitting bottom")
          //  - Impact with another existing word/token entry (stack interaction)
          // NOT walls (left/right) to prevent premature mid-air splits when brushing boundaries.
          const otherEntry =
            b.entryRef ||
            (b.parent && b.parent.entryRef);
          const isOtherWord = otherEntry && otherEntry !== entryA;
          const hitFloor = b === floorBody;
          if (hitFloor || isOtherWord) {
            sentenceImpactCallback(entryA);
          }
        }
      }
    }
  });
}

/**
 * Resize handling: rebuild static bounds; attempt to preserve dynamic bodies.
 * For simplicity, we rebuild walls & floor; dynamic bodies remain.
 */
export function handleResize(newW, newH) {
  canvasWidth = newW;
  canvasHeight = newH;

  World.remove(world, floorBody);
  World.remove(world, leftWall);
  World.remove(world, rightWall);

  floorBody = Bodies.rectangle(
    newW / 2,
    newH - PHYS.FLOOR_THICKNESS / 2,
    newW,
    PHYS.FLOOR_THICKNESS,
    { isStatic: true, friction: 1, restitution: 0, label: 'floor' }
  );
  leftWall = Bodies.rectangle(
    -PHYS.SIDE_WALL_THICKNESS / 2,
    newH / 2,
    PHYS.SIDE_WALL_THICKNESS,
    newH,
    { isStatic: true, label: 'wall-left' }
  );
  rightWall = Bodies.rectangle(
    newW + PHYS.SIDE_WALL_THICKNESS / 2,
    newH / 2,
    PHYS.SIDE_WALL_THICKNESS,
    newH,
    { isStatic: true, label: 'wall-right' }
  );

  World.add(world, [floorBody, leftWall, rightWall]);

  // Optional: could reposition existing bodies if now outside bounds; keep simple
  for (const we of wordEntries) {
    const b = we.body;
    if (b.position.x < -200 || b.position.x > newW + 200) {
      Body.setPosition(b, { x: clamp(b.position.x, 50, newW - 50), y: b.position.y });
    }
  }
}

/**
 * Create and add a word body (via wordBody.js helper).
 * wordMaker should be imported and passed by caller to avoid circular import.
 */
export function addWordEntry(entry) {
  // entry: { word, body, letterRects, lettersCount }
  wordEntries.push(entry);
  World.add(world, entry.body);
  // Attach reverse references for fast collision resolution (handles compound parts)
  entry.body.entryRef = entry;
  if (entry.body.parts && entry.body.parts.length) {
    for (const p of entry.body.parts) {
      p.entryRef = entry;
    }
  }
  // (No letter disassembly phase anymore after collapse)
  return entry;
}

/**
 * Remove all word bodies (used during shatter or reset).
 */
export function removeAllWords() {
  for (const w of wordEntries) {
    World.remove(world, w.body);
  }
  wordEntries.length = 0;
}



/* registerConstraint(c) legacy no-op retained for compatibility */
export function registerConstraint(c) { /* noop (crane removed) */ }

/* releaseConstraint(c) legacy no-op retained for compatibility */
export function releaseConstraint(c) { /* noop */ }

/**
 * Apply "pool" damping to word bodies near floor region.
 */
function applyPoolDamping() {
  const regionY = canvasHeight - PHYS.POOL_REGION;
  for (const w of wordEntries) {
    const b = w.body;
    if (b.position.y > regionY) {
      Body.setVelocity(b, {
        x: b.velocity.x * (1 - PHYS.POOL_DAMP_Y * 0.1),
        y: b.velocity.y * (1 - PHYS.POOL_DAMP_Y)
      });
      Body.setAngularVelocity(b, b.angularVelocity * (1 - PHYS.POOL_DAMP_Y));
    }
  }
}

/**
 * Evaluate collapse heuristics.
 */
function evaluateCollapse() {
  if (collapsed) return true;

  // (Early count-based collapse disabled; rely on grounded words + other heuristics)

  // Early rule: collapse once enough STABLE words are on the ground (must be near floor AND low motion)
  let groundCount = 0;
  const groundYThreshold = (canvasHeight - PHYS.FLOOR_THICKNESS) - PHYS.GROUND_Y_MARGIN;
  for (const w of wordEntries) {
    const b = w.body;
    if (b.position.y > groundYThreshold) {
      const linSpeed = Math.hypot(b.velocity.x, b.velocity.y);
      if (
        linSpeed < PHYS.GROUND_STABLE_LIN_VEL &&
        Math.abs(b.angularVelocity) < PHYS.GROUND_STABLE_ANG_VEL
      ) {
        groundCount++;
        if (groundCount >= PHYS.GROUND_COLLAPSE_COUNT) {
          return true;
        }
      }
    }
  }

  // 1) Any word far below (off screen => we treat that as collapse)
  for (const w of wordEntries) {
    if (w.body.position.y > canvasHeight + 100) {
      return true;
    }
  }

  // 2) COM lateral offset condition
  const bodies = wordEntries.map(e => e.body);
  if (bodies.length) {
    const com = computeCOM(bodies);
    const offset = Math.abs(com.x - canvasWidth / 2);
    const h = stackHeight(bodies);
    if (h > PHYS.MIN_HEIGHT_FOR_OFFSET_CHECK) {
      if (offset > canvasWidth * PHYS.COLLAPSE_OFFSET_RATIO) {
        return true;
      }
    }
  }

  // 3) Wakefulness measure
  let wakeCount = 0;
  for (const b of bodies) {
    if (
      Math.abs(b.velocity.x) > PHYS.VELOCITY_WAKE_THRESHOLD ||
      Math.abs(b.velocity.y) > PHYS.VELOCITY_WAKE_THRESHOLD ||
      Math.abs(b.angularVelocity) > PHYS.ANGULAR_WAKE_THRESHOLD
    ) {
      wakeCount++;
    }
  }
  if (wakeCount > Math.max(3, bodies.length * 0.5)) {
    wakeFrameCounter++;
    if (wakeFrameCounter > PHYS.WAKE_FRAMES_THRESHOLD) {
      return true;
    }
  } else {
    // decay
    wakeFrameCounter = Math.max(0, wakeFrameCounter - 2);
  }

  // Cap of number of words
  if (wordEntries.length > PHYS.MAX_WORDS) return true;

  return false;
}

/**
 * Mark collapsed & return boolean if just collapsed now.
 */
export function checkAndFlagCollapse() {
  if (!collapsed) {
    const should = evaluateCollapse();
    if (should) {
      collapsed = true;
      return true;
    }
  }
  return false;
}

/* Utility: find word entry by underlying Matter body */
function findWordEntryByBody(body) {
  return wordEntries.find(e => e.body === body);
}

/**
 * Split a compound word entry into individual letter bodies (rectangles),
 * preserving kinematics at impact to convey "breaking into letters".
 */
function splitWordEntry() {
  /* deprecated: letter-level breakup removed */
}

/* Impact-based delayed splitting removed (immediate mid-air split now). */

/**
 * Exported: split all existing (unsplit) words immediately (used on collapse).
 */
export function splitAllWordsNow() {
  /* deprecated no-op (letter breakup removed) */
}

/* Legacy shatterAll(fragmentGenerator) removed (fragment pipeline deprecated). */

/**
 * Mark collapse.
 * Softens gravity; tokens remain intact (no further breakup).
 */
export function markCollapsedNoShatter() {
  const preState = collapsed;
  if (!collapsed) collapsed = true;
  // Soften gravity once (tokens stay intact).
  if (!preState && engine) {
    engine.gravity.y = PHYS.GRAVITY_Y * PHYS.COLLAPSE_GRAVITY_SCALE;
  }
}

/**
 * Advance physics.
 * dtMillis: time step in ms (p5's deltaTime).
 */
export function stepPhysics(dtMillis) {
  if (!engine) return;
  // Limit dt to avoid spirals
  const clamped = Math.min(dtMillis, 50);
  Engine.update(engine, clamped);
  if (!collapsed) applyPoolDamping();
}

/**
 * Full reset.
 */
export function resetPhysics(w, h) {
  initPhysics(w, h);
  wakeFrameCounter = 0;
}

/**
 * Utility getter for drawing.
 */
export function getWordBodies() {
  return wordEntries;
}

/* Remove a single word entry (used for impact-based sentence→token split) */
export function removeWordEntry(entry) {
  if (!entry) return;
  const idx = wordEntries.indexOf(entry);
  if (idx !== -1) {
    World.remove(world, entry.body);
    wordEntries.splice(idx, 1);
  }
}

/* getFragmentBodies() removed (no fragments in current design). */

// Impact token split callback registration
let sentenceImpactCallback = null;
export function setSentenceImpactCallback(cb) {
  sentenceImpactCallback = cb;
}
