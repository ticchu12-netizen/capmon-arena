// Unit and property checks for the engine: number helpers, hashing, codes, habit layer,
// determinism, replay, and tamper detection.
'use strict';
const crypto = require('crypto');
const { E, loadModel, randomProfile, HOUSE } = require('./lib');
const model = loadModel();
let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) { if (cond) passed++; else { failed++; fails.push(name + (detail ? ' :: ' + detail : '')); } }
const rng = E.rngFrom('engine-checks');

// ---- exp / sigmoid / tanh ----
{
  let worst = 0;
  for (let i = 0; i < 200000; i++) { const x = (rng() * 2 - 1) * 60; const rel = Math.abs(E.dexp(x) - Math.exp(x)) / Math.exp(x); if (rel > worst) worst = rel; }
  check('dexp relative error under 1e-14', worst < 1e-14, String(worst));
  check('dexp(0) is exactly 1', E.dexp(0) === 1);
  check('dexp edges', E.dexp(800) === Infinity && E.dexp(-800) === 0 && Number.isNaN(E.dexp(NaN)));
  let ws = 0, wt = 0;
  for (let i = 0; i < 100000; i++) { const x = (rng() * 2 - 1) * 40; ws = Math.max(ws, Math.abs(E.sigmoid(x) - 1 / (1 + Math.exp(-x)))); wt = Math.max(wt, Math.abs(E.dtanh(x) - Math.tanh(x))); }
  check('sigmoid within 1e-15', ws < 1e-15, String(ws));
  check('tanh within 1e-15', wt < 1e-15, String(wt));
}
// ---- SHA-256 and base64url ----
{
  let ok = true, ok64 = true;
  for (let i = 0; i < 400; i++) {
    const len = i < 200 ? i : Math.floor(rng() * 5000);
    const b = new Uint8Array(len); for (let j = 0; j < len; j++) b[j] = Math.floor(rng() * 256);
    if (E.sha256Hex(b) !== crypto.createHash('sha256').update(b).digest('hex')) ok = false;
    const enc = E.b64urlEncode(b);
    if (enc !== Buffer.from(b).toString('base64url')) ok64 = false;
    const dec = E.b64urlDecode(enc);
    if (dec.length !== len || dec.some((v, k) => v !== b[k])) ok64 = false;
  }
  check('sha256 matches Node crypto', ok);
  check('sha256 of text', E.sha256Hex('héllo ⚡ 𝄞') === crypto.createHash('sha256').update('héllo ⚡ 𝄞', 'utf8').digest('hex'));
  check('base64url matches Node and round-trips', ok64);
  let threw = false; try { E.b64urlDecode('ab*d'); } catch (e) { threw = true; }
  check('base64url rejects bad characters', threw);
}
// ---- random streams ----
{
  const a = E.rngFrom('x'), b = E.rngFrom('x'), c = E.rngFrom('y');
  let same = true, diff = false, inRange = true;
  for (let i = 0; i < 1000; i++) { const va = a(), vb = b(), vc = c(); if (va !== vb) same = false; if (va !== vc) diff = true; if (!(va >= 0 && va < 1)) inRange = false; }
  check('same seed gives the same stream', same);
  check('different seed gives a different stream', diff);
  check('stream values are in [0, 1)', inRange);
  const r = E.rngFrom('uniform'); const bins = new Array(10).fill(0); for (let i = 0; i < 200000; i++) bins[Math.floor(r() * 10)]++;
  check('stream is roughly uniform', bins.every(v => Math.abs(v - 20000) < 600), bins.join(','));
}
// ---- habit layer ----
{
  const seen = new Set();
  for (const sa of E.SPECIES_NAMES) for (const sb of E.SPECIES_NAMES) {
    const A = E.createFighter(sa), B = E.createFighter(sb);
    for (let ha = 0; ha <= 20; ha++) for (let hb = 0; hb <= 20; hb++) for (const t of [1, 3, 4, 8, 9, 30]) {
      A.currentHP = Math.round(A.maxHP * ha / 20); B.currentHP = Math.round(B.maxHP * hb / 20);
      const b = E.bucketOf(A, B, t); seen.add(b);
      const d = E.decodeBucket(b);
      if (((d.own * 3 + d.opp) * 3 + d.rel) * 3 + d.ph !== b) check('decodeBucket inverts bucketOf', false, String(b));
    }
  }
  check('all 108 situations are addressable', seen.size === 108 && Math.min(...seen) === 0 && Math.max(...seen) === 107, String(seen.size));
  check('type relation', E.typeRelation(E.TYPE.FIRE, E.TYPE.GRASS) === 0 && E.typeRelation(E.TYPE.FIRE, E.TYPE.WATER) === 2 && E.typeRelation(E.TYPE.FIRE, E.TYPE.FIRE) === 1);

  const p = E.newProfile();
  check('untaught randomness is 0.40', E.epsilonOf(p) === 0.40);
  let credits = 0;
  for (let b = 0; b < 20; b++) for (let i = 0; i < 3; i++) if (E.recordTurn(p, b, 1, 'd1')) credits++;
  check('at most 8 new situations per day', credits === 8 && p.coveredCount === 8, credits + '/' + p.coveredCount);
  for (let b = 0; b < 20; b++) if (E.recordTurn(p, b, 1, 'd2')) credits++;
  check('next day continues coverage', credits === 16 && p.coveredCount === 16, String(credits));
  check('two samples do not cover', (() => { const q = E.newProfile(); E.recordTurn(q, 5, 0, 'd'); return E.recordTurn(q, 5, 0, 'd') === false && E.recordTurn(q, 5, 0, 'd') === true; })());
  const full = E.newProfile(); for (let b = 0; b < 108; b++) { full.covered[b] = true; } full.coveredCount = 60;
  check('randomness floor is 0.20 at 60 covered', Math.abs(E.epsilonOf(full) - 0.20) < 1e-12);
  full.coveredCount = 108; check('randomness never goes under the floor', Math.abs(E.epsilonOf(full) - 0.20) < 1e-12);

  const q = E.newProfile(); const F = E.createFighter('Tsunami');
  for (let i = 0; i < 4; i++) E.recordTurn(q, 7, 2, 'd');
  check('four samples: habit cannot act yet', E.habitInfo(q, 7, F).eligible === false && E.habitInfo(q, 7, F).why === 'few');
  E.recordTurn(q, 7, 2, 'd');
  const h = E.habitInfo(q, 7, F);
  check('five agreeing samples: habit acts at the cap', h.eligible && h.modal === 2 && h.p === 0.35, JSON.stringify(h));
  for (let i = 0; i < 5; i++) E.recordTurn(q, 7, i % 2 ? 0 : 1, 'd');
  const h2 = E.habitInfo(q, 7, F);
  check('share 0.5: probability is 0.25', h2.eligible && Math.abs(h2.p - 0.25) < 1e-12, JSON.stringify(h2));
  E.recordTurn(q, 7, 0, 'd');
  check('split habits do not act', E.habitInfo(q, 7, F).eligible === false && E.habitInfo(q, 7, F).why === 'split');
  const u = E.newProfile(); for (let i = 0; i < 6; i++) E.recordTurn(u, 9, 3, 'd'); F.moves[3].pp = 0;
  check('habit for a spent move does not act', E.habitInfo(u, 9, F).eligible === false && E.habitInfo(u, 9, F).why === 'used');

  // memory cap: old habits can be overwritten
  const m = E.newProfile(); for (let i = 0; i < 100; i++) E.recordTurn(m, 3, 0, 'd');
  check('memory holds 24 samples per situation', E.bucketTotal(m, 3) === 24);
  for (let i = 0; i < 13; i++) E.recordTurn(m, 3, 2, 'd');
  check('thirteen new choices flip a full habit', E.habitInfo(m, 3, null).modal === 2 && E.bucketTotal(m, 3) === 24, JSON.stringify(E.habitInfo(m, 3, null)));
}
// ---- brain codes ----
{
  let ok = true, maxLen = 0, minLen = 1e9;
  for (let i = 0; i < 300; i++) {
    const p = randomProfile(rng, Math.floor(rng() * 200));
    const code = E.profileCode(p); maxLen = Math.max(maxLen, code.length); minLen = Math.min(minLen, code.length);
    const q = E.profileFromCode(code);
    for (let b = 0; b < E.BUCKETS; b++) { if (p.covered[b] !== q.covered[b]) ok = false; for (let a = 0; a < 4; a++) if (p.counts[b * 5 + a] !== q.counts[b * 5 + a]) ok = false; }
    if (p.coveredCount !== q.coveredCount || E.profileHash(p) !== E.profileHash(q) || E.epsilonOf(p) !== E.epsilonOf(q)) ok = false;
  }
  check('brain code round-trips', ok);
  check('brain code length', E.profileCode(E.newProfile()).length === 39 && minLen >= 39 && maxLen <= 399, minLen + '..' + maxLen);
  let threw = 0; for (const bad of ['', 'AAAA', 'Ag' + 'A'.repeat(40), '!!!!']) { try { E.profileFromCode(bad); } catch (e) { threw++; } }
  check('bad brain codes are rejected', threw === 4, String(threw));
  // a code that claims samples but is cut short
  const p = randomProfile(rng, 60); const code = E.profileCode(p);
  let cut = false; try { E.profileFromCode(code.slice(0, code.length - 8)); } catch (e) { cut = true; }
  check('cut brain codes are rejected', cut);
}
// ---- determinism, replay, tamper detection ----
{
  const brains = () => [HOUSE('60M'), HOUSE('40M'), HOUSE('15M'), { kind: 'student', profile: randomProfile(rng, 70) }, { kind: 'student', profile: E.newProfile() }];
  let det = true, rep = true, ver = true, tamper = 0, tamperTried = 0, differs = 0, games = 0, timeouts = 0, coinFirstA = 0, coinRounds = 0;
  const hashes = new Set();
  for (let g = 0; g < 180; g++) {
    const bs = brains();
    const a = { species: E.SPECIES_NAMES[g % 3], brain: bs[g % 5] }, b = { species: E.SPECIES_NAMES[Math.floor(g / 3) % 3], brain: bs[Math.floor(g / 5) % 5] };
    const rules = g % 3 === 0 ? { commit: 'sequential', tie: 'sideA' } : {};
    const seed = 'det-' + g;
    const g1 = E.createGame({ seed, a, b, model, rules }).run(), g2 = E.createGame({ seed, a, b, model, rules }).run();
    const t1 = g1.transcript(), t2 = g2.transcript();
    games++; if (g1.timeout) timeouts++;
    if (E.transcriptHash(t1) !== E.transcriptHash(t2)) det = false;
    hashes.add(E.transcriptHash(t1));
    const r = E.replayTranscript(JSON.parse(JSON.stringify(t1)));
    if (!r.ok || r.winner !== g1.winner || r.rounds !== g1.round) { rep = false; if (fails.length < 20) fails.push('replay: ' + seed + ' ' + JSON.stringify(r.problems)); }
    const v = E.verifyDecisions(t1, { a: a.brain, b: b.brain }, model);
    if (!v.ok) ver = false;
    if (a.species === b.species && !rules.tie) for (const rd of g1.rounds) { coinRounds++; if (rd.first === 'A') coinFirstA++; }
    // tampering
    const mut = [
      t => { t.actions[0].dmg += 1; },
      t => { const x = t.actions[t.actions.length - 1]; x.hpA = Math.max(0, x.hpA - 1) + (x.hpA === 0 ? 1 : 0); },
      t => { t.result.winner = t.result.winner === 'A' ? 'B' : 'A'; },
      t => { t.actions.pop(); },
      t => { t.actions.push(Object.assign({}, t.actions[t.actions.length - 1])); },
      t => { t.seed = t.seed + 'x'; },
      t => { const i = Math.floor(t.actions.length / 2); t.actions[i].m = (t.actions[i].m + 1) % 3; },
      t => { const i = t.actions.findIndex((x, k) => k > 0 && x.t === t.actions[k - 1].t); if (i > 0) { const tmp = t.actions[i]; t.actions[i] = t.actions[i - 1]; t.actions[i - 1] = tmp; } else t.result.rounds++; },
      t => { t.a.species = t.a.species === 'Tsunami' ? 'Rageblaze' : 'Tsunami'; },
      t => { t.result.rounds += 1; }
    ];
    const f = mut[g % mut.length]; const tt = JSON.parse(JSON.stringify(t1)); f(tt); tamperTried++;
    if (!E.replayTranscript(tt).ok) tamper++; else if (fails.length < 20) fails.push('tamper not caught: mutation ' + (g % mut.length) + ' seed ' + seed);
    // wrong brain must fail the decision check
    if (a.brain.kind === 'student' && g % 2) { const other = { kind: 'student', profile: randomProfile(rng, 70) }; if (!E.verifyDecisions(t1, { a: other, b: b.brain }, model).ok) differs++; else differs += 0; }
  }
  check('same seed, same game (180 games)', det);
  check('different seeds give different games', hashes.size === 180, String(hashes.size));
  check('replay from moves agrees with the engine', rep);
  check('re-deciding with the same brains agrees', ver);
  check('tampered records are caught', tamper === tamperTried, tamper + '/' + tamperTried);
  check('a different brain fails the decision check', differs > 0);
  check('coin flip for equal speed is fair', coinRounds > 200 && Math.abs(coinFirstA / coinRounds - 0.5) < 0.08, coinFirstA + '/' + coinRounds);
  for (const junk of [null, 5, 'x', {}, { a: {}, b: {}, actions: [] }, { a: { species: 'Tsunami' }, b: { species: 'Nope' }, actions: [] }, { a: { species: 'Tsunami' }, b: { species: 'Tsunami' }, actions: [{ t: 1, s: 'A', m: 9 }], result: {} }, { a: { species: 'Tsunami' }, b: { species: 'Tsunami' }, actions: 'no' }]) {
    let r; try { r = E.replayTranscript(junk); } catch (e) { r = { ok: true, threw: String(e) }; }
    check('junk transcript is rejected without throwing', r.ok === false, JSON.stringify(junk).slice(0, 60) + ' ' + (r.threw || ''));
  }
}
// ---- human sides ----
{
  const g = E.createGame({ seed: 'human-1', a: { species: 'Rageblaze', brain: { kind: 'human', shadow: HOUSE('60M') } }, b: { species: 'Tsunami', brain: HOUSE('60M') }, model });
  check('human side is flagged', g.needsInput.A === true && g.needsInput.B === false);
  let threw = false; try { g.playRound({}); } catch (e) { threw = true; }
  check('missing human move is an error', threw);
  check('a failed round changes nothing', g.round === 0 && g.rounds.length === 0, 'round=' + g.round);
  threw = false; try { g.playRound({ A: 4 }); } catch (e) { threw = true; }
  check('move 4 (Heal) is refused', threw && g.round === 0);
  // The human's advice brain must not change the game: same seed and same moves with and without advice.
  const play = shadow => {
    const gg = E.createGame({ seed: 'human-2', a: { species: 'Healspike', brain: shadow ? { kind: 'human', shadow } : { kind: 'human' } }, b: { species: 'Tsunami', brain: HOUSE('40M') }, model });
    const r = E.rngFrom('human-moves');
    while (!gg.over) { const v = E.usableMoves(gg.fighters.A); gg.playRound({ A: v[Math.floor(r() * v.length)] }); }
    return gg;
  };
  const plain = play(null), advised = play(HOUSE('60M'));
  check('advice does not change the game', E.transcriptHash(plain.transcript()) === E.transcriptHash(advised.transcript()));
  check('advice is recorded each round', advised.rounds.every(rd => rd.dA.shadow && rd.dA.probs && rd.dA.src === 'HUMAN'));
  check('human game replays', E.replayTranscript(plain.transcript()).ok);
  const used = advised.rounds.findIndex(rd => rd.dA.final === 3);
  check('a human can use the big move once', used < 0 || advised.rounds.slice(used + 1).every(rd => rd.dA.final !== 3));
}
console.log(JSON.stringify({ passed, failed }));
if (fails.length) console.log('FAILURES\n' + fails.join('\n'));
console.log('RESULT:', failed === 0 ? 'PASS' : 'FAIL');
process.exit(failed === 0 ? 0 : 1);
