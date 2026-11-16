// Shared helpers for the test scripts.
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../docs/js/engine.js');

const ROOT = path.resolve(__dirname, '..');
function loadModel() {
  const buf = fs.readFileSync(path.join(ROOT, 'docs/assets/brain.bin'));
  return E.createModel(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

/** A synthetic trainer: a profile with strong habits in `n` random situations. */
function randomProfile(rng, n) {
  const p = E.newProfile();
  for (let k = 0; k < n; k++) {
    const b = Math.floor(rng() * E.BUCKETS);
    const fav = Math.floor(rng() * 4);
    const reps = 3 + Math.floor(rng() * 12);
    for (let i = 0; i < reps; i++) {
      const a = rng() < 0.8 ? fav : Math.floor(rng() * 4);
      E.recordTurn(p, b, a, 'day' + (k % 20));
    }
  }
  return p;
}

const HOUSE = g => ({ kind: 'house', grade: g });
module.exports = { E, ROOT, loadModel, randomProfile, HOUSE };
