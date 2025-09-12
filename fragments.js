/**
 * fragments.js
 * Responsible for generating fragment physics bodies from a word entry
 * when the tower collapses (shatter).
 *
 * Public API:
 *  createFragmentsForEntry(entry, options?) -> Array<{ body }>
 *
 * A word entry comes from wordBody.js:
 * {
 *   word,
 *   body,        // Matter compound
 *   letterRects, // relative rects [{x,y,w,h,char}]
 *   width,
 *   height
 * }
 *
 * Strategy:
 *  - For each letter rectangle, generate N small convex triangle fragments
 *    using the deterministic fragmentRectangle() helper (utils.js).
 *  - Transform rectangle local coordinates into world space using the
 *    letter's parent word body's current transform (angle + position).
 *  - Each triangle becomes a Matter body (Bodies.fromVertices) if available;
 *    since triangles are already convex we avoid the need for poly-decomp.
 *  - Apply a small outward (radial) impulse from the word's center plus
 *    per-fragment jitter to create an explosive dispersion.
 *
 * Performance considerations:
 *  - Limit fragments per letter (default 8).
 *  - Global cap enforced in physics.addFragments().
 */

import { fragmentRectangle, clamp, rand, randomRange } from './utils.js';
import { world } from './physics.js';

const {
  Bodies,
  Body,
  Vector
} = Matter;

export const FRAG_DEFAULTS = {
  piecesPerLetter: 8,
  fragmentRestitution: 0.05,
  fragmentFriction: 0.8,
  fragmentDensity: 0.0006,
  radialImpulse: 0.006,   // base impulse scale
  radialJitter: 0.004,    // random additional impulse
  angularJitter: 0.02
};

/**
 * Transform a local point (relative to word body) into world coordinates.
 */
function localToWorld(body, pt) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.position.x + pt.x * cos - pt.y * sin,
    y: body.position.y + pt.x * sin + pt.y * cos
  };
}

/**
 * Given local vertices (already relative to word body origin),
 * convert them into world space.
 */
function transformPolygon(body, poly) {
  return poly.map(p => localToWorld(body, p));
}

/**
 * Build a Matter triangle body from world polygon coords.
 */
function buildTriangle(poly, opts) {
  // Compute centroid for body positioning
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;

  // Re-center vertices relative to centroid
  const verts = poly.map(p => ({ x: p.x - cx, y: p.y - cy }));

  // Create a body using Bodies.fromVertices (triangles are convex).
  const b = Bodies.fromVertices(cx, cy, [verts], {
    restitution: opts.fragmentRestitution,
    friction: opts.fragmentFriction,
    density: opts.fragmentDensity
  }, true);

  return b;
}

/**
 * Generate fragments for a single letter rectangle (local coordinates).
 * rect: {x,y,w,h,char}
 */
function fragmentsForLetter(wordBody, rect, cfg) {
  const maxPieces = cfg.piecesPerLetter;
  const charSeed = rect.char ? rect.char.charCodeAt(0) : 0;
  // fragmentRectangle expects local rectangle coordinates
  const polysLocal = fragmentRectangle(rect.x, rect.y, rect.w, rect.h, charSeed, maxPieces);

  const bodies = [];
  for (const poly of polysLocal) {
    const worldPoly = transformPolygon(wordBody, poly);
    const triBody = buildTriangle(worldPoly, cfg);
    if (triBody) bodies.push(triBody);
  }
  return bodies;
}

/**
 * Create fragment bodies for an entire word entry.
 */
export function createFragmentsForEntry(entry, overrides = {}) {
  const cfg = { ...FRAG_DEFAULTS, ...overrides };
  const result = [];
  const wb = entry.body;

  // Word center for impulses
  const center = { x: wb.position.x, y: wb.position.y };

  for (const rect of entry.letterRects) {
    const frBodies = fragmentsForLetter(wb, rect, cfg);
    for (const fb of frBodies) {
      // Radial impulse (scaled by distance + jitter)
      const dir = Vector.normalise({
        x: fb.position.x - center.x + randomRange(-5, 5),
        y: fb.position.y - center.y + randomRange(-5, 5)
      });
      const impulseMag = cfg.radialImpulse + rand() * cfg.radialJitter;
      Body.applyForce(fb, fb.position, {
        x: dir.x * impulseMag,
        y: dir.y * impulseMag
      });
      Body.setAngularVelocity(fb, (rand() - 0.5) * cfg.angularJitter);
      // Store a slight tone variance so shattered letters feel like pieces of the word block
      result.push({ body: fb, tone: 220 + Math.floor(rand() * 35) });
    }
  }
  return result;
}
