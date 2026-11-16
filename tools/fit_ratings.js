// House ratings from a round robin of full matches (first to two mirror games).
//   node tools/fit_ratings.js play <part> <parts> <matchesPerPair> <out.json>
//   node tools/fit_ratings.js fit <part files...>        writes the ratings into docs/js/game.js
// An untaught brain is included as the anchor and fixed at 1000.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const E = require(path.join(root, 'docs/js/engine.js'));
const G = require(path.join(root, 'docs/js/game.js'));
const mode = process.argv[2];
const ids = G.ROSTER.map(h => h.id).concat(['untaught']);

if (mode === 'play') {
  const part = Number(process.argv[3]), parts = Number(process.argv[4]), N = Number(process.argv[5]), outFile = process.argv[6];
  const buf = fs.readFileSync(path.join(root, 'docs/assets/brain.bin'));
  const model = E.createModel(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const blank = E.profileCode(E.newProfile());
  const ref = (id, k) => id === 'untaught' ? G.studentRef('Untaught', G.SPECIES[k % 3], blank) : G.houseRef(id);
  const res = {}; let pairNo = 0, games = 0; const t0 = Date.now();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if ((pairNo++) % parts !== part) continue;
    let wi = 0, g3 = 0;
    for (let k = 0; k < N; k++) {
      const swap = k % 2 === 1;                       // alternate seats
      const a = swap ? ref(ids[j], k) : ref(ids[i], k), b = swap ? ref(ids[i], k) : ref(ids[j], k);
      const r = G.playMatch({ seed: 'fit|' + ids[i] + '|' + ids[j] + '|' + k, a, b }, model);
      games += r.games.length; if (r.games.length === 3) g3++;
      if ((r.winner === 'A') !== swap) wi++;
    }
    res[ids[i] + '|' + ids[j]] = { wins: wi, n: N, threeGames: g3 };
  }
  fs.writeFileSync(outFile, JSON.stringify({ res, games, seconds: Math.round((Date.now() - t0) / 1000) }));
  console.log('part', part, 'done', games, 'games');
} else if (mode === 'fit') {
  const W = {}, Nn = {}; ids.forEach(a => { W[a] = {}; Nn[a] = {}; ids.forEach(b => { W[a][b] = 0; Nn[a][b] = 0; }); });
  let total = 0, three = 0, games = 0;
  for (const f of process.argv.slice(3)) { const d = JSON.parse(fs.readFileSync(f, 'utf8')); games += d.games; for (const k of Object.keys(d.res)) { const [a, b] = k.split('|'); const r = d.res[k]; W[a][b] += r.wins; W[b][a] += r.n - r.wins; Nn[a][b] += r.n; Nn[b][a] += r.n; total += r.n; three += r.threeGames; } }
  // Bradley-Terry by the usual iteration, with half a virtual win each way so no rating runs to infinity.
  const PRIOR = 0.5; const p = {}; ids.forEach(a => p[a] = 1);
  for (let it = 0; it < 2000; it++) {
    const np = {};
    for (const a of ids) { let w = 0, den = 0; for (const b of ids) { if (a === b || !Nn[a][b]) continue; w += W[a][b] + PRIOR; den += (Nn[a][b] + 2 * PRIOR) / (p[a] + p[b]); } np[a] = w / den; }
    let gm = 0; ids.forEach(a => gm += Math.log(np[a])); gm = Math.exp(gm / ids.length); ids.forEach(a => p[a] = np[a] / gm);
  }
  const rating = {}; ids.forEach(a => rating[a] = Math.round(1000 + 400 * Math.log10(p[a] / p.untaught)));
  const table = ids.slice().sort((a, b) => rating[b] - rating[a]).map(a => { let w = 0, n = 0; ids.forEach(b => { w += W[a][b]; n += Nn[a][b]; }); return { id: a, rating: rating[a], winRate: +(w / n).toFixed(3), vsUntaught: a === 'untaught' ? null : +(W[a].untaught / Nn[a].untaught).toFixed(3) }; });
  console.log(JSON.stringify({ matches: total, games, wentToThreeGames: +(three / total).toFixed(3), table }, null, 1));
  const out = {}; G.ROSTER.forEach(h => out[h.id] = rating[h.id]);
  const file = path.join(root, 'docs/js/game.js'); let src = fs.readFileSync(file, 'utf8');
  const re = /\/\*RATINGS-BEGIN\*\/[\s\S]*?\/\*RATINGS-END\*\//;
  if (!re.test(src)) throw new Error('marker not found');
  fs.writeFileSync(file, src.replace(re, '/*RATINGS-BEGIN*/' + JSON.stringify(out) + '/*RATINGS-END*/'));
  fs.writeFileSync(path.join(root, 'test/out/ratings_fit.json'), JSON.stringify({ rating, table, W, matches: total }, null, 1));
} else { console.error('usage: play|fit'); process.exit(2); }
