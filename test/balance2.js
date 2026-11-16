// Second balance experiment: which layers should a student brain have?
// Usage: node test/balance2.js <species> <gamesPerCell> <outfile>
'use strict';
const fs = require('fs');
const { E, loadModel, HOUSE } = require('./lib');
const model = loadModel();
const sp = process.argv[2] || 'Rageblaze', N = Number(process.argv[3] || 100), outFile = process.argv[4];
function coverAll(p) { for (let b = 0; b < E.BUCKETS; b++) if (E.bucketTotal(p, b) >= E.MIN_COVER && !p.covered[b]) { p.covered[b] = true; p.coveredCount++; } return p; }
function fixedStyle(moveFor) { const p = E.newProfile(); for (let b = 0; b < E.BUCKETS; b++) { const m = moveFor(E.decodeBucket(b)); for (let i = 0; i < 12; i++) p.counts[b * E.ACTIONS + m]++; } return coverAll(p); }
const full = (eps, profile) => ({ kind: 'spec', mcts: true, overrides: true, eps, profile });
const B = {
  'full AI': full(0),
  'full AI, 20% random': full(0.2), 'full AI, 30% random': full(0.3), 'full AI, 40% random': full(0.4),
  'planner only': { kind: 'spec', mcts: true, overrides: false, eps: 0 },
  'planner only, 20% random': { kind: 'spec', mcts: true, overrides: false, eps: 0.2 },
  'rules only': { kind: 'spec', mcts: false, overrides: true, eps: 0 },
  'model only': { kind: 'spec', mcts: false, overrides: false, eps: 0 },
  'full 20% + always typed': full(0.2, fixedStyle(() => 1)),
  'full 20% + always Headbutt': full(0.2, fixedStyle(() => 0)),
  'full 20% + always Intimidate': full(0.2, fixedStyle(() => 2)),
  'full 20% + Intimidate early then typed': full(0.2, fixedStyle(d => (d.ph === 0 ? 2 : 1))),
  'full 20% + big move when opp low': full(0.2, fixedStyle(d => (d.opp === 0 ? 3 : 1))),
  'full 20% + Headbutt when opp low': full(0.2, fixedStyle(d => (d.opp === 0 ? 0 : 1)))
};
const cells = [
  ['full AI', 'full AI'], ['full AI, 20% random', 'full AI'], ['full AI, 30% random', 'full AI'], ['full AI, 40% random', 'full AI'],
  ['full AI, 20% random', 'full AI, 40% random'], ['full AI, 30% random', 'full AI, 40% random'],
  ['planner only', 'full AI'], ['rules only', 'full AI'], ['model only', 'full AI'], ['planner only, 20% random', 'full AI, 20% random'],
  ['model only', 'full AI, 40% random'], ['rules only', 'full AI, 40% random'],
  ['full 20% + always typed', 'full AI, 20% random'], ['full 20% + always Headbutt', 'full AI, 20% random'], ['full 20% + always Intimidate', 'full AI, 20% random'],
  ['full 20% + Intimidate early then typed', 'full AI, 20% random'], ['full 20% + big move when opp low', 'full AI, 20% random'], ['full 20% + Headbutt when opp low', 'full AI, 20% random'],
  ['full 20% + always typed', 'full AI'], ['full 20% + always Intimidate', 'full AI']
];
const out = { species: sp, gamesPerCell: N, cells: {} };
const t0 = Date.now();
for (const [a, b] of cells) {
  let aw = 0, rounds = 0;
  for (let g = 0; g < N; g++) { const game = E.createGame({ seed: 'bal2|' + sp + a + b + g, a: { species: sp, brain: B[a] }, b: { species: sp, brain: B[b] }, model }).run(); if (game.winner === 'A') aw++; rounds += game.round; }
  out.cells[a + ' | ' + b] = { aWin: +(aw / N).toFixed(3), avgRounds: +(rounds / N).toFixed(1) };
}
out.seconds = Math.round((Date.now() - t0) / 1000);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
