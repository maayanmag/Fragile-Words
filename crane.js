/**
 * crane.js
 * Abstract white crane that:
 *  - Watches for a word body resting in the "pool"
 *  - Moves arm above it, lowers cable, attaches via a temporary constraint
 *  - Performs a swing animation
 *  - Releases (toss) the word with slight impulse & spin
 *
 * Kinematic only: purely animated via math, not physics.
 *
 * States:
 *  IDLE -> SEEK_WORD -> LOWERING -> ATTACHED -> SWINGING -> RELEASE -> RETURNING -> IDLE
 *
 * Exported API:
 *  initCrane(w, h)
 *  updateCrane(p, dt)
 *  drawCrane(p)
 *  resetCrane(w, h)
 *
 * Configurable constants surfaced below for tuning.
 */

import {
  wordEntries,
  registerConstraint,
  releaseConstraint,
  isCollapsed
} from './physics.js';

import {
  rand,
  randomRange,
  easeInOutQuad,
  easeOutQuad,
  clamp
} from './utils.js';

const { Bodies, Constraint, Body, Vector } = Matter;

export const CRANE_CFG = {
  pivotRatioX: 0.18,
  pivotRatioY: 0.22,
  armLengthRatio: 0.32,
  cableMin: 40,
  cableMax: 360,
  armStrokeWeight: 2,
  cableStrokeWeight: 1.5,
  baseHeightRatio: 0.28,
  pickupVelocityThreshold: 1.2,
  pickupAngularThreshold: 0.7,
  pickupHeightOffset: 200,
  lowerDuration: 800,
  raiseDuration: 650,
  swingDuration: 1050,
  returnDuration: 900,
  releaseAngleOffset: 0.35,
  impulseXRange: [0.0022, 0.0045],
  impulseYRange: [0.0030, 0.0055],
  spinRange: [-0.25, 0.35],
  targetScanInterval: 600,
  armBaseAngle: -0.35,
  armSwingAngle: 0.9,
  releaseProgress: 0.72,
  // New targeting / smoothing params
  targetAngleLerp: 0.15,          // faster convergence toward target
  maxSeekAngleSpan: 0.6,          // horizontal mapping span
  baseSeekAngle: -0.25            // center angle when word centered
};

// Internal crane state
let canvasW = 0;
let canvasH = 0;

let pivot = { x: 0, y: 0 };
let armLength = 0;

let state = 'IDLE';
let stateTime = 0;

let targetEntry = null;
let constraint = null;

let cableLength = 120; // animated
let desiredCableLength = 120;

let armAngle = CRANE_CFG.armBaseAngle;
let armAngleStart = CRANE_CFG.armBaseAngle;
let armAngleEnd = CRANE_CFG.armSwingAngle;

let lastTargetScan = 0;

let releasedThisSwing = false;
let attachedEntry = null; // currently attached entry for magnet visualization

/**
 * Initialize crane.
 */
export function initCrane(w, h) {
  canvasW = w;
  canvasH = h;
  pivot.x = w * CRANE_CFG.pivotRatioX;
  pivot.y = h * CRANE_CFG.pivotRatioY;
  armLength = w * CRANE_CFG.armLengthRatio;
  state = 'IDLE';
  stateTime = 0;
  targetEntry = null;
  constraint = null;
  armAngle = CRANE_CFG.armBaseAngle;
  armAngleStart = armAngle;
  releasedThisSwing = false;
  cableLength = 120;
  desiredCableLength = 120;
  lastTargetScan = 0;
}

/**
 * Reset crane (used on full reset).
 */
export function resetCrane(w, h) {
  if (constraint) {
    releaseConstraint(constraint);
    constraint = null;
  }
  initCrane(w, h);
}

/**
 * Find a resting word candidate in pool region.
 */
function findPickupCandidate(now) {
  if (now - lastTargetScan < CRANE_CFG.targetScanInterval) return null;
  lastTargetScan = now;

  // Choose earliest non-launched word near bottom & stable
  let candidate = null;
  const poolY = canvasH - CRANE_CFG.pickupHeightOffset;
  for (const e of wordEntries) {
    if (e.launched) continue;
    const b = e.body;
    if (b.position.y > poolY) {
      const v = b.velocity;
      if (
        Math.abs(v.x) < CRANE_CFG.pickupVelocityThreshold &&
        Math.abs(v.y) < CRANE_CFG.pickupVelocityThreshold &&
        Math.abs(b.angularVelocity) < CRANE_CFG.pickupAngularThreshold
      ) {
        candidate = e;
        break;
      }
    }
  }
  return candidate;
}

/**
 * Transition helper.
 */
function setState(next) {
  state = next;
  stateTime = 0;
  if (next === 'SWINGING') {
    armAngleStart = armAngle;
    // end target angle with slight randomness
    armAngleEnd = CRANE_CFG.armSwingAngle + (rand() - 0.5) * 0.15;
    releasedThisSwing = false;
  }
}

/**
 * Attach word via constraint (simulate hook).
 */
function attachWord(entry) {
  if (!entry) return;
  const body = entry.body;
  attachedEntry = entry;
  // Compute contact cable length so hook touches top half of word
  const contactLen = clamp(
    body.position.y - pivot.y - Math.sin(armAngle) * armLength - (entry.height || 30) * 0.45,
    CRANE_CFG.cableMin,
    CRANE_CFG.cableMax
  );
  desiredCableLength = contactLen;
  const hookPos = getHookWorldPos();
  // Create constraint
  constraint = Constraint.create({
    pointA: { x: hookPos.x, y: hookPos.y },
    bodyB: body,
    pointB: { x: 0, y: 0 },
    stiffness: 0.95,
    damping: 0.08,
    length: 0
  });
  registerConstraint(constraint);
}

/**
 * Release currently attached word (apply toss impulse & spin).
 */
function releaseWord() {
  if (!constraint || !targetEntry) return;
  const body = targetEntry.body;
  releaseConstraint(constraint);
  constraint = null;
  attachedEntry = null;

  // Directional impulse along arm direction with extra upward lift
  const mass = body.mass || 1;
  let dir = {
    x: Math.cos(armAngle),
    y: Math.sin(armAngle) - 0.45 // bias upward to arc over stack
  };
  const mag = Math.hypot(dir.x, dir.y) || 1;
  dir.x /= mag;
  dir.y /= mag;

  const baseMag = randomRange(...CRANE_CFG.impulseXRange) * (0.9 + rand() * 0.4);
  const force = {
    x: dir.x * baseMag * mass,
    y: dir.y * baseMag * -1 * mass // negative because upward bias already negative
  };

  Body.applyForce(body, body.position, force);
  Body.setAngularVelocity(body, randomRange(...CRANE_CFG.spinRange));

  targetEntry.launched = true;
  targetEntry = null;
}

/**
 * Compute hook position from pivot, arm angle, and cable length.
 */
function getHookWorldPos() {
  const ax = pivot.x + Math.cos(armAngle) * armLength;
  const ay = pivot.y + Math.sin(armAngle) * armLength;
  return {
    x: ax,
    y: ay + cableLength
  };
}

/**
 * Update kinematic constraint anchor to follow hook motion.
 */
function updateConstraintAnchor() {
  if (!constraint) return;
  const hook = getHookWorldPos();
  constraint.pointA.x = hook.x;
  constraint.pointA.y = hook.y;
}

/**
 * Update crane state machine.
 */
export function updateCrane(p, dt) {
  if (isCollapsed()) return; // disabled after collapse
  stateTime += dt;
  const now = performance.now();

  // Smooth cable length toward desired
  cableLength += (desiredCableLength - cableLength) * 0.12;

  switch (state) {
    case 'IDLE': {
      const candidate = findPickupCandidate(now);
      if (candidate) {
        targetEntry = candidate;
        setState('SEEK_WORD');
      }
      break;
    }
    case 'SEEK_WORD': {
      if (!targetEntry) {
        setState('IDLE');
        break;
      }
      // Horizontal alignment first, cable mostly retracted
      const tx = targetEntry.body.position.x;
      const dx = tx - pivot.x;
      const norm = clamp(dx / (canvasW * 0.5), -1, 1);
      const angleTarget = CRANE_CFG.baseSeekAngle + norm * CRANE_CFG.maxSeekAngleSpan;
      armAngle += (angleTarget - armAngle) * (CRANE_CFG.targetAngleLerp * 0.8);
      // Keep cable retracted while aligning
      desiredCableLength += (CRANE_CFG.cableMin - desiredCableLength) * 0.15;

      if (stateTime > 260) {
        setState('LOWERING');
      }
      break;
    }
    case 'LOWERING': {
      if (!targetEntry) {
        setState('RETURNING');
        break;
      }
      const body = targetEntry.body;
      const wordTop = body.position.y - (targetEntry.height || 30) * 0.5;
      const armEndX = pivot.x + Math.cos(armAngle) * armLength;
      const armEndY = pivot.y + Math.sin(armAngle) * armLength;
      const targetLen = clamp(wordTop - armEndY, CRANE_CFG.cableMin, CRANE_CFG.cableMax);
      const t = clamp(stateTime / CRANE_CFG.lowerDuration, 0, 1);
      const eased = easeInOutQuad(t);
      // Ease toward target length
      desiredCableLength += (targetLen - desiredCableLength) * (0.12 + 0.4 * eased);

      const hook = getHookWorldPos();
      const dy = Math.abs(hook.y - wordTop);
      if (dy < 6 || t >= 1) {
        attachWord(targetEntry);
        setState('ATTACHED');
      }
      break;
    }
    case 'ATTACHED': {
      if (!targetEntry) {
        setState('RETURNING');
        break;
      }
      // Maintain contact cable length while attached
      const body = targetEntry.body;
      const contactLen = clamp(
        body.position.y - pivot.y - Math.sin(armAngle) * armLength - (targetEntry.height || 30) * 0.45,
        CRANE_CFG.cableMin,
        CRANE_CFG.cableMax
      );
      desiredCableLength += (contactLen - desiredCableLength) * 0.3;
      // Short settling delay then start swinging
      if (stateTime > 200) {
        setState('SWINGING');
      }
      break;
    }
    case 'SWINGING': {
      if (!constraint) {
        setState('RETURNING');
        break;
      }
      const t = clamp(stateTime / CRANE_CFG.swingDuration, 0, 1);
      const eased = easeOutQuad(t);
      armAngle = armAngleStart + (armAngleEnd - armAngleStart) * eased;

      // Keep hook in light contact (slight tension) with attached body
      if (attachedEntry) {
        const body = attachedEntry.body;
        const contactLen = clamp(
          body.position.y - pivot.y - Math.sin(armAngle) * armLength - (attachedEntry.height || 30) * 0.42,
          CRANE_CFG.cableMin,
          CRANE_CFG.cableMax
        );
        desiredCableLength += (contactLen - desiredCableLength) * 0.25;
      } else {
        desiredCableLength = clamp(cableLength - 0.6, CRANE_CFG.cableMin, CRANE_CFG.cableMax);
      }

      if (!releasedThisSwing && t >= CRANE_CFG.releaseProgress) {
        releaseWord();
        releasedThisSwing = true;
        setState('RETURNING');
      }
      break;
    }
    case 'RETURNING': {
      // Bring arm back to base angle & retract cable
      const t = clamp(stateTime / CRANE_CFG.returnDuration, 0, 1);
      armAngle += (CRANE_CFG.armBaseAngle - armAngle) * 0.08;
      desiredCableLength += (120 - desiredCableLength) * 0.12;

      if (t >= 1) {
        setState('IDLE');
      }
      break;
    }
    default:
      setState('IDLE');
  }

  updateConstraintAnchor();
}

/**
 * Draw crane.
 */
export function drawCrane(p) {
  p.push();
  p.stroke(255);
  p.noFill();
  p.strokeWeight(CRANE_CFG.armStrokeWeight);

  // Base / mast
  const baseH = canvasH * CRANE_CFG.baseHeightRatio;
  p.line(pivot.x - 18, baseH, pivot.x + 18, baseH);
  p.line(pivot.x, baseH, pivot.x, pivot.y);

  // Arm
  const armEndX = pivot.x + Math.cos(armAngle) * armLength;
  const armEndY = pivot.y + Math.sin(armAngle) * armLength;
  p.line(pivot.x, pivot.y, armEndX, armEndY);

  // Cable + hook
  const hook = getHookWorldPos();
  p.strokeWeight(CRANE_CFG.cableStrokeWeight);
  p.line(armEndX, armEndY, hook.x, hook.y);

  // Hook (core)
  p.circle(hook.x, hook.y, 8);

  // Magnet aura when holding a word
  if (attachedEntry && constraint) {
    const t = (performance.now() * 0.004) % Math.PI;
    const pulse = 10 + Math.sin(t) * 4;
    p.stroke(255, 180);
    p.circle(hook.x, hook.y, pulse);
    p.stroke(255, 90);
    p.circle(hook.x, hook.y, pulse * 1.6);
  }

  p.pop();
}

/**
 * Must be called on window resize.
 */
export function resizeCrane(w, h) {
  canvasW = w;
  canvasH = h;
  pivot.x = w * CRANE_CFG.pivotRatioX;
  pivot.y = h * CRANE_CFG.pivotRatioY;
  armLength = w * CRANE_CFG.armLengthRatio;
}
