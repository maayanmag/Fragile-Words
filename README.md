# Fragile Words

An interactive experiment on words, meaning, and how machines break them apart, by Maayan Magenheim.  

## Live Experience

Visit the live version here: **https://fragilewords.netlify.app/**


![Gameplay Demo](fragile_words_screenrecording_updated.gif)

## Concept

Language (for us) arrives as cohesive sentences; for machines (large language models) those sentences are decomposed into sub‑word tokens (byte pair encoding / BPE). This piece stages that difference:

1. You type an English sentence (ASCII letters/spaces).
2. It falls as a single solid block (a human semantic unit).
3. On its **first physical impact** it splits into GPT‑2 BPE tokens (the machine’s internal segmentation).
4. Tokens accumulate into an unstable tower; instability triggers collapse — words shatter (fragments) yet trace the broken structure of the original sentence.

Result: a small meditation on how meaning is assembled, partitioned, and lost in translation between human intent and machine sequence processing.

## English‑Only Input

The experience intentionally supports **English alphabetic input only (A–Z / a–z and spaces)**.  
Non‑ASCII characters and punctuation are ignored or separated. This constraint mirrors the tokenizer emphasis on base Latin text and keeps geometry simple.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Loads p5.js, Matter.js, tokenizer + main sketch |
| `styles.css` | Layout & minimal UI styling (black theme) |
| `sketch.js` | Main p5 loop: spawning, split timing, rendering |
| `physics.js` | Matter.js world setup, instability + collapse heuristics, shatter |
| `wordBody.js` | Per‑letter rectangular hull layout (compound bodies) |
| `ui.js` | Sentence input, font size control, reset, tokenizer gating |
| `tokenizer.js` | GPT‑2 BPE loader (remote + local fallback + mock) |
| `utils.js` | Deterministic RNG, math helpers, fragmentation helpers |
| `fragments.js` | Procedural fragment generation for shatter |
| `crane.js` | (Legacy / not active in current UI) |
| `fragile_words_screenrecording_updated.gif` | Demo animation |

## Interaction

- Type an English sentence and press Enter (input gated until tokenizer is ready or a fallback is declared).
- The sentence block falls.
- On **first impact** (floor or existing stack) it splits into GPT‑2 BPE tokens.
- Tokens keep original momentum (linear + angular) at the moment of splitting.
- As the precarious stack destabilizes (excess lean, off‑screen spill, kinetic wakefulness) a collapse is triggered:
  - Tokens shatter into deterministic triangular fragments.
  - Gravity softens slightly for settling.
- Press **Start again** to fully reset (physics world, RNG seed, tokenizer state already cached if loaded).

## Controls

| Action | Key / UI |
|--------|----------|
| Submit sentence | Enter |
| Reset simulation | Start again button |
| Adjust future token size | Font size slider (default 40px) |

## Default Visual Parameters

- Background: `#000`
- Token blocks: white rounded rectangles (1px stroke) with black glyph centers
- Default font size (initial letter height base): **40px**
- Fragment color: solid white (performance > stylization)

## Tokenization (GPT‑2 BPE) with Local Fallback

The tokenizer loader attempts the following in order:

1. **Local static assets (preferred if present):**  
   - `encoder.local.json`  
   - `vocab.local.bpe`  
   Place these files in the project root to guarantee offline, immediate, authentic GPT‑2 BPE tokenization.
2. **Remote endpoints (first to succeed wins):**  
   - Raw GitHub (OpenAI gpt-2 repo)  
   - OpenAI Azure blob  
   - jsDelivr GitHub mirror  
   - HuggingFace model repo (direct resolve)
3. **Heuristic mock mode** (only if all endpoints fail and no local files): vowel/consonant segmentation + punctuation isolation to at least preserve a “broken into pieces” aesthetic.

### Query Flags

| Flag | Effect |
|------|--------|
| `?skipLocal=1` | Ignore local files and force remote attempt sequence |
| `?forceMock=1` | Skip real loading, activate heuristic segmentation immediately |

### Status Modes (Console + UI)

- `Tokenizer ready (GPT‑2 BPE)` — real GPT‑2 ranks loaded (local or remote).
- `Tokenizer mock mode` — heuristic segmentation (supply local files to upgrade).
- `Tokenizer failed – click to retry` — network error; user can retry.

Input remains disabled while in `loading` to prevent early whole‑sentence render without true token boundaries (unless a definitive failure triggers fallback).

## Physics & Collapse Heuristics

Implemented via Matter.js with surfaced constants:

- Gravity: moderate downward pull (tunable)
- Damping “pool” near floor reduces chaotic settling
- Collapse triggers (any two sufficient; we use several):
  - Off‑screen vertical fall
  - Center of mass lateral displacement beyond threshold relative to tower height
  - Sustained kinetic “wakefulness” (velocity/rotation counts)
  - Word count cap (auto‑collapse safety)

On collapse:
- Each letter rectangle produces deterministic 6–12 triangle fragments.
- Fragments receive outward impulses and limited angular jitter.
- Post‑collapse gravity slightly reduced.

## Determinism

A seed constant drives:
- RNG for release noise / fragment patterns
- Consistent fragmentation between runs (unless seed changed)

Reset re‑applies the seed for reproducible splits & shatters.

## Performance Safeguards

- Cap of 25 live sentence/token word bodies (auto‑collapse if exceeded)
- Fragment cap (~1500) prevents runaway geometry
- Delayed (1 frame) impact split reduces jitter on conversion
- Minimal per‑frame allocations (reuse arrays where practical)

## Accessibility / Constraints

- English alphabet only (A–Z / a–z, space)
- Non‑ASCII characters are stripped
- Long tokens truncated internally if extremely narrow glyphs appear (visual stability)
- No audio; purely visual metaphor

## Running

Just open `index.html` in a modern browser (desktop recommended). No build or bundling required.

If network is blocked:
1. Download GPT‑2 assets from:  
   - https://raw.githubusercontent.com/openai/gpt-2/master/models/124M/encoder.json  
   - https://raw.githubusercontent.com/openai/gpt-2/master/models/124M/vocab.bpe  
2. Rename/save as `encoder.local.json` and `vocab.local.bpe` in the project root.
3. Reload the page (no query flags). Console should report:  
   `Mode: bpe Source: local`.

To test remote loading ignoring local: append `?skipLocal=1` to the URL.  
To simulate heuristic fallback: append `?forceMock=1`.

## Extensibility Ideas (Not Implemented Yet)

- Soft fragment fade / aging
- Dynamic crane (archival code exists) to throw tokens instead of straight falls
- Stack height–aware toss energy modulation
- Alternate language tokenizers with different constraints (would require new glyph handling)

## License

Creative use and educational remixing encouraged. Please attribute “Fragile Words – Maayan Magenheim” when forking or exhibiting.

---
Made with p5.js, Matter.js, and curiosity about how meaning fractures inside machine token streams.
