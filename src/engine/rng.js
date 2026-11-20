/*
 * Seeded pseudo-random number generator and small helpers.
 * A seed makes battles and tests reproducible.
 */

export function createRng(seed = Date.now()) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

export function int(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

export function shuffle(rng, items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sample(rng, items, count) {
  return shuffle(rng, items).slice(0, count);
}
