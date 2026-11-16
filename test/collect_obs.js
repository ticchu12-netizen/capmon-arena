// Plays games with every kind of brain and records every call to the policy network:
// the 192 inputs, the 4 masks, and what the plain-JS model answered.
// Output is compared against onnxruntime by test/model_parity.py.
'use strict';
const fs = require('fs');
const path = require('path');
const { E, ROOT, loadModel, randomProfile, HOUSE } = require('./lib');

const GAMES = Number(process.argv[2] || 600);
const model = loadModel();
const obsRows = [], maskRows = [], logitRows = [], actions = [];
const orig = model.policy;
let ms = 0, calls = 0;
model.policy = (obs, mask) => {
  const t0 = process.hrtime.bigint();
  const r = orig(obs, mask);
  ms += Number(process.hrtime.bigint() - t0) / 1e6; calls++;
  obsRows.push(Float32Array.from(obs)); maskRows.push(Float32Array.from(mask));
  logitRows.push(Float64Array.from(r.logits)); actions.push(r.action);
  return r;
};

const rng = E.rngFrom('collect-obs');
const kinds = ['60M', '40M', '15M', 'student', 'student'];
const pickBrain = () => { const k = kinds[Math.floor(rng() * kinds.length)]; return k === 'student' ? { kind: 'student', profile: randomProfile(rng, 10 + Math.floor(rng() * 80)) } : HOUSE(k); };
let rounds = 0;
for (let g = 0; g < GAMES; g++) {
  const a = E.SPECIES_NAMES[g % 3], b = E.SPECIES_NAMES[Math.floor(g / 3) % 3];
  const rules = { commit: g % 2 ? 'simultaneous' : 'sequential', tie: g % 4 < 2 ? 'coin' : 'sideA' };
  const game = E.createGame({ seed: 'obs-' + g, a: { species: a, brain: pickBrain() }, b: { species: b, brain: pickBrain() }, model, rules }).run();
  rounds += game.round;
}
// Stress rows: values the game never produces, to exercise clipping and every mask shape.
const stress = 4000;
for (let i = 0; i < stress; i++) {
  const obs = new Array(192);
  const scale = i % 4 === 0 ? 50 : i % 4 === 1 ? 3 : 1;
  for (let j = 0; j < 192; j++) obs[j] = (rng() * 2 - 0.5) * scale;
  const mask = [1, rng() < 0.7 ? 1 : 0, rng() < 0.7 ? 1 : 0, rng() < 0.5 ? 1 : 0];
  model.policy(obs, mask);
}
const n = obsRows.length;
const cat = (rows, T, w) => { const out = new T(n * w); rows.forEach((r, i) => out.set(r, i * w)); return Buffer.from(out.buffer); };
const out = path.join(ROOT, 'test/out');
fs.writeFileSync(path.join(out, 'obs.f32'), cat(obsRows, Float32Array, 192));
fs.writeFileSync(path.join(out, 'masks.f32'), cat(maskRows, Float32Array, 4));
fs.writeFileSync(path.join(out, 'logits.f64'), cat(logitRows, Float64Array, 4));
fs.writeFileSync(path.join(out, 'actions.u8'), Buffer.from(Uint8Array.from(actions)));
console.log(JSON.stringify({ games: GAMES, rounds, decisions: n - stress, stressRows: stress, msPerDecision: +(ms / calls).toFixed(3) }));
