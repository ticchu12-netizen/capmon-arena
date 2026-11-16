// Win rates under Arena rules (both sides pick at the start of the round, coin flip on
// equal speed). Answers: how strong is each kind of brain, and how much do habits and
// coverage matter. Usage: node test/balance.js <species|cross> <gamesPerCell> <outfile>
'use strict';
const fs = require('fs');
const { E, loadModel, HOUSE } = require('./lib');
const model = loadModel();
const what = process.argv[2] || 'Rageblaze', N = Number(process.argv[3] || 100), outFile = process.argv[4];

// ---- synthetic trainers ----
function coverAll(p) { for (let b = 0; b < E.BUCKETS; b++) if (E.bucketTotal(p, b) >= E.MIN_COVER && !p.covered[b]) { p.covered[b] = true; p.coveredCount++; } return p; }
function fixedStyle(moveFor) {          // a trainer with one rule, taught in every situation
  const p = E.newProfile();
  for (let b = 0; b < E.BUCKETS; b++) { const m = moveFor(E.decodeBucket(b)); for (let i = 0; i < 12; i++) p.counts[b * E.ACTIONS + m]++; }
  return coverAll(p);
}
function floorOnly() {                   // lowest randomness, but too few samples anywhere for a habit to act
  const p = E.newProfile();
  for (let b = 0; b < 60; b++) for (let i = 0; i < 3; i++) p.counts[b * E.ACTIONS + (i % 3)]++;
  return coverAll(p);
}
function imitate(grade, games) {         // a trainer who copies what a house brain plays
  const p = E.newProfile(); let k = 0;
  for (const a of E.SPECIES_NAMES) for (const b of E.SPECIES_NAMES) for (let g = 0; g < games; g++) {
    const game = E.createGame({ seed: 'imitate|' + grade + '|' + a + b + g, a: { species: a, brain: HOUSE(grade) }, b: { species: b, brain: HOUSE(grade) }, model }).run();
    for (const rd of game.rounds) { E.recordTurn(p, rd.dA.bucket, rd.dA.final, 'd' + (k++)); E.recordTurn(p, rd.dB.bucket, rd.dB.final, 'd' + (k++)); }
  }
  return coverAll(p);
}
const student = profile => ({ kind: 'student', profile });
const BRAINS = {
  'house 60M': HOUSE('60M'), 'house 40M': HOUSE('40M'), 'house 15M': HOUSE('15M'),
  'student untaught': student(E.newProfile()),
  'student covered, no habits': student(floorOnly()),
  'student copies 60M': student(imitate('60M', 40)),
  'student always Headbutt': student(fixedStyle(() => 0)),
  'student always typed move': student(fixedStyle(() => 1)),
  'student always Intimidate': student(fixedStyle(() => 2)),
  'student big move early': student(fixedStyle(d => (d.ph === 0 ? 3 : 1))),
  'student Intimidate then typed': student(fixedStyle(d => (d.ph === 0 ? 2 : 1))),
  'student Intimidate then Headbutt': student(fixedStyle(d => (d.ph === 0 ? 2 : 0)))
};
const names = Object.keys(BRAINS);
const out = { what, gamesPerCell: N, rules: E.DEFAULT_RULES, cells: {}, info: {} };
for (const n of names) if (BRAINS[n].kind === 'student') out.info[n] = { randomness: +E.epsilonOf(BRAINS[n].profile).toFixed(3), covered: BRAINS[n].profile.coveredCount };

function play(a, b, sa, sb, tag) {
  let aw = 0, rounds = 0, to = 0;
  for (let g = 0; g < N; g++) {
    const game = E.createGame({ seed: 'bal|' + tag + '|' + g, a: { species: sa, brain: BRAINS[a] }, b: { species: sb, brain: BRAINS[b] }, model }).run();
    if (game.winner === 'A') aw++; rounds += game.round; if (game.timeout) to++;
  }
  return { aWin: +(aw / N).toFixed(3), avgRounds: +(rounds / N).toFixed(1), timeouts: to };
}
const t0 = Date.now();
if (what === 'cross') {
  for (const sa of E.SPECIES_NAMES) for (const sb of E.SPECIES_NAMES) out.cells[sa + ' vs ' + sb] = play('house 60M', 'house 60M', sa, sb, 'x' + sa + sb);
} else {
  const houses = names.filter(n => n.startsWith('house'));
  for (const a of names) for (const b of houses) { if (a.startsWith('house') && houses.indexOf(a) > houses.indexOf(b)) continue; out.cells[a + ' | ' + b] = play(a, b, what, what, what + a + b); }
  const st = names.filter(n => n.startsWith('student'));
  for (const a of st) if (a !== 'student untaught') out.cells[a + ' | student untaught'] = play(a, 'student untaught', what, what, what + a + 'u');
}
out.seconds = Math.round((Date.now() - t0) / 1000);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
