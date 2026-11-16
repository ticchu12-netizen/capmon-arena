// Whole-battle comparison against the server engine (ref/battleSim.js + onnxruntime).
//
// The server engine draws from Math.random. Here Math.random is replaced by a seeded
// stream, the server plays a battle, and then this engine plays the same matchup with
// all of its random streams pointed at an identical stream, using the server's round
// rules (each side picks just before acting, side A wins speed ties). Every turn of
// the two logs must agree: who acted, which move, damage, critical hit, both HP totals.
'use strict';
const path = require('path');
const fs = require('fs');
const { E, ROOT, loadModel } = require('./lib');
const server = require('../ref/battleSim.js');

const SEEDS = Number(process.argv[2] || 100);
const model = loadModel();
const COMPAT = { commit: 'sequential', tie: 'sideA', maxRounds: 50 };
const BRAIN = { kind: 'house', grade: '60M' };

(async () => {
  const realRandom = Math.random;
  const stats = { battles: 0, identical: 0, different: 0, turns: 0, timeouts: 0, byPair: {} };
  const diffs = [];
  const silence = console.log; console.log = () => {};           // the server module logs model loading
  try {
    for (const a of E.SPECIES_NAMES) for (const b of E.SPECIES_NAMES) {
      const key = a + ' vs ' + b;
      const ps = stats.byPair[key] = { battles: 0, aWins: 0, rounds: 0 };
      for (let s = 0; s < SEEDS; s++) {
        const seed = 'golden|' + key + '|' + s;
        Math.random = E.rngFrom(seed);
        let ref;
        try { ref = await server.runBattle(a, b); } finally { Math.random = realRandom; }
        const shared = E.rngFrom(seed);
        const g = E.createGame({ seed, a: { species: a, brain: BRAIN }, b: { species: b, brain: BRAIN }, model, rules: COMPAT, rng: { mech: shared, a: shared, b: shared } }).run();
        stats.battles++; ps.battles++; ps.rounds += g.round; stats.turns += g.actions.length;
        if (g.timeout) stats.timeouts++;
        if (g.winner === 'A') ps.aWins++;
        let problem = null;
        if (ref.turnLog.length !== g.actions.length) problem = 'turn count ' + ref.turnLog.length + ' vs ' + g.actions.length;
        for (let i = 0; !problem && i < ref.turnLog.length; i++) {
          const r = ref.turnLog[i], m = g.actions[i];
          const same = r.round === m.t && (r.attacker === 'capbot' ? 'A' : 'B') === m.s && r.moveIdx === m.m && r.damageDealt === m.dmg && (r.isCrit ? 1 : 0) === m.crit && r.capbotHp === m.hpA && r.opponentHp === m.hpB;
          if (!same) problem = 'turn ' + i + ': server ' + JSON.stringify({ t: r.round, s: r.attacker, m: r.moveIdx, dmg: r.damageDealt, crit: r.isCrit, a: r.capbotHp, b: r.opponentHp }) + ' engine ' + JSON.stringify(m);
        }
        if (!problem && ref.result !== (g.winner === 'A')) problem = 'winner differs';
        if (problem) { stats.different++; if (diffs.length < 10) diffs.push({ seed, problem }); } else stats.identical++;
      }
    }
  } finally { console.log = silence; }
  for (const k of Object.keys(stats.byPair)) { const p = stats.byPair[k]; p.aWinRate = +(p.aWins / p.battles).toFixed(3); p.avgRounds = +(p.rounds / p.battles).toFixed(1); delete p.rounds; }
  console.log(JSON.stringify(stats, null, 1));
  if (diffs.length) console.log('DIFFERENCES', JSON.stringify(diffs, null, 1));
  fs.writeFileSync(path.join(ROOT, 'test/out/golden_vs_server.json'), JSON.stringify({ seedsPerPair: SEEDS, stats, diffs }, null, 1));
  console.log('RESULT:', stats.different === 0 ? 'PASS' : 'FAIL');
  process.exit(stats.different === 0 ? 0 : 1);
})();
