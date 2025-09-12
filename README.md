# Fragile Words

An interactive experiment built with p5.js and Matter.js, created as part of a personal pre-course exploration ahead of the M.Des Design & Technology program at Bezalel Academy of Arts and Design.

## Concept

Language can feel like stacking meaning — one sentence resting on another, trying to hold. But machines don’t see sentences. They see tokens.

This piece stages that contrast:

1. You type a sentence — a single cohesive unit of meaning (human view).
2. The sentence drops as one solid block.
3. Upon its **first impact**, it splits into subword tokens using GPT‑2's BPE encoding — the “machine view” emerges.
4. As the stack grows unstable, the tower collapses. Gravity softens. But the tokens remain.

It's a small meditation on how meaning is built, broken, and interpreted — by us, and by machines.

![Gameplay Demo](fragile_words_screenrecording.gif)

## Files

- `index.html` – Loads p5.js, Matter.js, and UI
- `styles.css` – UI styling
- `sketch.js` – Rendering, input, animation
- `physics.js` – Matter.js world, collision logic, collapse heuristics
- `wordBody.js` – Sentence and token geometry
- `ui.js` – Input, tokenizer interface, slider
- `tokenizer.js` – GPT-2 BPE tokenization
- `utils.js` – Helpers, RNG
- (Legacy) `crane.js`, `fragments.js`

## Interaction

- Type a sentence and press Enter
- The sentence falls
- First impact → token split
- Collapse occurs under instability (leaning, overflow, wakefulness)
- Font size slider affects future text
- “Start again” resets simulation and randomness

## Controls

| Action                | Key / UI             |
|----------------------|----------------------|
| Submit sentence      | Enter                |
| Reset simulation     | Start again button   |
| Adjust font size     | Font size slider     |

## Tokenization

Uses GPT‑2 BPE (byte pair encoding). The UI now HARD‑GATES submission until the real tokenizer fully loads, preventing premature whole‑word blocks: the input is disabled and shows “Loading GPT‑2 tokenizer…” until BPE data arrives. Only if the tokenizer fails to load (network error) do we enable a clearly flagged fallback mode (“Tokenizer failed – fallback segmentation active”). Each submitted sentence therefore almost always carries true subword tokens. The sentence falls intact and splits into those tokens only on its first physical impact (floor or another token stack) — no mid‑air or time‑based splitting.

## Physics Highlights

- Equal-mass 2D rigid body physics via Matter.js
- First impact triggers delayed split (1 frame)
- Tokens inherit linear/angular momentum
- Collapse triggers: lean, count, bounce, spill, ground accumulation

## Rendering

- Dark background (#000)
- White rounded rectangles with black text
- Sentence and tokens visually identical — only behavior distinguishes them

## Purpose

To contrast:

- Human stacking of coherent meaning
- Machine decomposition into fragmented subword units

This is a study in how words break, and what remains.

## Running

Open `index.html` in any modern desktop browser. No build step required.

## License

Creative use encouraged. Feel free to fork, remix, or extend with attribution.
