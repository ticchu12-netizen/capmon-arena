/*!
 * Capmon Arena, Season 0 rules on top of the engine: the house roster, the match
 * format, ratings, the daily card, and the codes that pack brains and matches into
 * links. Pure logic, no page access, so it runs in Node for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.CapmonGame = factory(root.CapmonEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const SEASON = 'S0';
  const SPECIES = E.SPECIES_NAMES;
  const START_RATING = 1000;      // an untaught brain
  const K_FACTOR = 32;
  const MATCHES_PER_DAY = 3;
  const NAME_MAX = 16;

  // ====================================================================
  // House roster
  // ====================================================================
  // A house character with habits is built the same way a player's brain is: a habit
  // table. `moveFor` gets the situation ({own, opp, rel, ph}) and returns a move 0..3.
  function styleProfile(moveFor) {
    const p = E.newProfile();
    for (let b = 0; b < E.BUCKETS; b++) {
      p.counts[b * E.ACTIONS + moveFor(E.decodeBucket(b))] = 12;
      p.covered[b] = true;
    }
    p.coveredCount = E.BUCKETS;
    return p;
  }
  const plain = (eps) => ({ kind: 'spec', mcts: false, overrides: false, eps: eps });
  const styled = (moveFor, eps) => ({ kind: 'spec', mcts: false, overrides: false, eps: eps, profile: styleProfile(moveFor) });

  // Ratings come from tools/fit_ratings.js (a round robin of full matches); do not edit by hand.
  const RATINGS = /*RATINGS-BEGIN*/{"glare":886,"static":1025,"pebble":967,"bonk":1104,"fuse":1110,"torrent":1128,"opal":1179,"marshal":1153,"vex":1354,"apex":1611}/*RATINGS-END*/;

  const ROSTER = [
    { id: 'glare',   name: 'Glare',   starter: 'Healspike', bio: 'Intimidate in every situation. Four moves in ten are random.',
      brain: styled(() => 2, 0.40) },
    { id: 'static',  name: 'Static',  starter: 'Rageblaze', bio: 'No plan at all. Six moves in ten are random.',
      brain: plain(0.60) },
    { id: 'pebble',  name: 'Pebble',  starter: 'Tsunami',   bio: 'The model on instinct alone. One move in four is random.',
      brain: { kind: 'house', grade: '15M' } },
    { id: 'bonk',    name: 'Bonk',    starter: 'Rageblaze', bio: 'Headbutt first, questions later.',
      brain: styled(() => 0, 0.20) },
    { id: 'fuse',    name: 'Fuse',    starter: 'Rageblaze', bio: 'Element attacks, and the big move once you are hurt.',
      brain: styled(d => (d.opp === 0 ? 3 : 1), 0.20) },
    { id: 'torrent', name: 'Torrent', starter: 'Tsunami',   bio: 'Leads with its element every single time.',
      brain: styled(() => 1, 0.20) },
    { id: 'opal',    name: 'Opal',    starter: 'Healspike', bio: 'Softens you up early, then strikes with its element.',
      brain: styled(d => (d.ph === 0 ? 2 : 1), 0.20) },
    { id: 'marshal', name: 'Marshal', starter: 'Tsunami',   bio: 'The model plus the game\'s hard-coded rules. One move in ten is random.',
      brain: { kind: 'house', grade: '40M' } },
    { id: 'vex',     name: 'Vex',     starter: 'Healspike', bio: 'The full game AI with a wild streak: four moves in ten are random.',
      brain: { kind: 'spec', mcts: true, overrides: true, eps: 0.40 } },
    { id: 'apex',    name: 'Apex',    starter: 'Rageblaze', bio: 'The full game AI: model, planner and rules, no random moves. The opponent Capmon World players fight.',
      brain: { kind: 'house', grade: '60M' } }
  ];
  const ROSTER_BY_ID = {};
  ROSTER.forEach(h => { h.rating = RATINGS[h.id] || START_RATING; ROSTER_BY_ID[h.id] = h; });

  // ====================================================================
  // Names and codes
  // ====================================================================
  /** Makes any string safe to keep as a display name (still escape it when rendering). */
  function cleanName(s) {
    let out = '';
    const str = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    let n = 0;
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) continue;                 // control
      if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f) continue;   // text direction tricks
      if (c === 0xfeff || (c >= 0xfff0 && c <= 0xffff)) continue;
      out += ch;
      if (++n >= NAME_MAX) break;
    }
    return out.trim() || 'Trainer';
  }
  const utf8Decode = bytes => {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return decodeURIComponent(escape(s));
  };
  const encText = s => E.b64urlEncode(E.utf8(s));
  const decText = (s, max) => { if (s.length > max) throw new Error('code field is too long'); return utf8Decode(E.b64urlDecode(s)); };
  const B64URL = /^[A-Za-z0-9_-]*$/;

  /** A side of a match: a player's brain or a house character. */
  function studentRef(name, starter, profileOrCode) {
    return { kind: 'student', name: cleanName(name), starter: starter, code: typeof profileOrCode === 'string' ? profileOrCode : E.profileCode(profileOrCode) };
  }
  function houseRef(id) { return { kind: 'house', id: id }; }
  function refInfo(ref) {
    if (ref.kind === 'house') { const h = ROSTER_BY_ID[ref.id]; return { name: h.name, starter: h.starter, house: true, bio: h.bio, rating: h.rating }; }
    return { name: ref.name, starter: ref.starter, house: false };
  }
  function brainOf(ref) {
    if (ref.kind === 'house') return ROSTER_BY_ID[ref.id].brain;
    return { kind: 'student', profile: E.profileFromCode(ref.code) };
  }
  function refFields(ref) {
    if (ref.kind === 'house') return ['h', ref.id, '0', '0'];
    return ['s', encText(ref.name), String(SPECIES.indexOf(ref.starter)), ref.code];
  }
  function refFromFields(f) {
    if (f[0] === 'h') { if (!ROSTER_BY_ID.hasOwnProperty(f[1])) throw new Error('unknown house brain'); return houseRef(f[1]); }
    if (f[0] !== 's') throw new Error('unknown brain kind');
    const idx = Number(f[2]);
    if (!(idx === 0 || idx === 1 || idx === 2)) throw new Error('unknown starter');
    if (f[3].length > 420 || !B64URL.test(f[3]) || !B64URL.test(f[1])) throw new Error('brain code is malformed');
    E.profileFromCode(f[3]);                                   // throws if it does not decode
    return { kind: 'student', name: cleanName(decText(f[1], 100)), starter: SPECIES[idx], code: f[3] };
  }

  /** Brain code: one player's brain, for export, import and challenge links. */
  function encodeBrainCode(ref) { return 'b1.' + refFields(ref).slice(1).join('.'); }
  function decodeBrainCode(str) {
    const f = String(str || '').trim().split('.');
    if (f.length !== 4 || f[0] !== 'b1') throw new Error('this is not a brain code');
    return refFromFields(['s', f[1], f[2], f[3]]);
  }

  /** Match code: seed, both sides, and the claimed winners of each game (for example "ABA"). */
  function encodeMatchCode(m) {
    return ['m1', encText(m.seed)].concat(refFields(m.a), refFields(m.b), [m.winners]).join('.');
  }
  function decodeMatchCode(str) {
    const s = String(str || '').trim();
    if (s.length > 1600) throw new Error('match code is too long');
    const f = s.split('.');
    if (f.length !== 11 || f[0] !== 'm1') throw new Error('this is not a match code');
    if (!B64URL.test(f[1])) throw new Error('match code is malformed');
    if (!/^[AB]{2,3}$/.test(f[10])) throw new Error('match code has no result');
    return { seed: decText(f[1], 200), a: refFromFields(f.slice(2, 6)), b: refFromFields(f.slice(6, 10)), winners: f[10] };
  }
  /** Pulls a code out of pasted text: a bare code or a link that contains one. */
  function findCode(text) {
    const m = /(?:^|[#&?=\s])((?:m1|b1)\.[A-Za-z0-9_.-]+)/.exec(String(text || '').trim());
    return m ? m[1] : null;
  }

  // ====================================================================
  // Match format: mirror games, first to two wins
  // ====================================================================
  /** Game 1 is on side A's starter, game 2 on side B's, game 3 on what is left. */
  function matchOrder(starterA, starterB, seed) {
    const order = [starterA];
    if (starterB !== starterA) order.push(starterB);
    const rest = SPECIES.filter(s => order.indexOf(s) < 0);
    if (rest.length === 2 && E.rngFrom(seed + '|order')() < 0.5) rest.reverse();
    return order.concat(rest);
  }
  const gameSeed = (matchSeed, i) => matchSeed + '|g' + (i + 1);

  /** Builds (does not run) game `i` of a match, for watching round by round. */
  function createMatchGame(m, i, model) {
    const order = matchOrder(refInfo(m.a).starter, refInfo(m.b).starter, m.seed);
    return E.createGame({ seed: gameSeed(m.seed, i), a: { species: order[i], brain: brainOf(m.a) }, b: { species: order[i], brain: brainOf(m.b) }, model: model });
  }
  /** Plays a whole match. `m` = { seed, a: ref, b: ref }. */
  function playMatch(m, model) {
    const order = matchOrder(refInfo(m.a).starter, refInfo(m.b).starter, m.seed);
    const brainA = brainOf(m.a), brainB = brainOf(m.b);
    const games = [];
    let wa = 0, wb = 0, winners = '';
    for (let i = 0; i < 3 && wa < 2 && wb < 2; i++) {
      const g = E.createGame({ seed: gameSeed(m.seed, i), a: { species: order[i], brain: brainA }, b: { species: order[i], brain: brainB }, model: model }).run();
      if (g.winner === 'A') wa++; else wb++;
      winners += g.winner;
      games.push({ species: order[i], winner: g.winner, rounds: g.round, hpA: g.fighters.A.currentHP, hpB: g.fighters.B.currentHP, maxHP: g.fighters.A.maxHP, timeout: g.timeout });
    }
    return { seed: m.seed, a: m.a, b: m.b, order: order, games: games, score: [wa, wb], winner: wa > wb ? 'A' : 'B', winners: winners };
  }
  /** Re-runs a match code and says whether the claimed result is what the engine produces. */
  function verifyMatchCode(code, model) {
    let m;
    try { m = decodeMatchCode(code); } catch (e) { return { ok: false, error: e.message }; }
    const r = playMatch(m, model);
    return { ok: r.winners === m.winners, claimed: m.winners, replayed: r.winners, match: r };
  }

  // ====================================================================
  // Ratings, tiers, the daily card
  // ====================================================================
  const expectedScore = (r, opp) => 1 / (1 + Math.pow(10, (opp - r) / 400));
  const ratingDelta = (r, opp, won) => Math.round(K_FACTOR * ((won ? 1 : 0) - expectedScore(r, opp)));

  const TIERS = [
    { name: 'Hatchling', min: -Infinity }, { name: 'Rookie', min: 950 }, { name: 'Contender', min: 1050 },
    { name: 'Veteran', min: 1150 }, { name: 'Elite', min: 1300 }, { name: 'Champion', min: 1500 }
  ];
  function tierOf(rating) { let t = TIERS[0]; for (const x of TIERS) if (rating >= x.min) t = x; return t.name; }

  /** Today's three opponents: different house brains, the ones nearest in rating most likely. */
  function dailyOpponents(playerId, day, rating) {
    const r = E.rngFrom([SEASON, 'card', playerId, day].join('|'));
    const pool = ROSTER.map(h => ({ id: h.id, rating: h.rating, w: 1 / (1 + Math.pow((h.rating - rating) / 120, 2)) }));
    const picks = [];
    for (let k = 0; k < MATCHES_PER_DAY; k++) {
      let total = 0; for (const p of pool) total += p.w;
      let x = r() * total, idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { x -= pool[i].w; if (x < 0) { idx = i; break; } }
      picks.push(pool.splice(idx, 1)[0]);
    }
    picks.sort((a, b) => a.rating - b.rating);
    return picks.map(p => p.id);
  }
  const rankedSeed = (playerId, day, slot) => [SEASON, day, playerId, slot].join('|');

  /** Standings: the roster plus one extra row for the player. */
  function standings(player) {
    const rows = ROSTER.map(h => ({ id: h.id, name: h.name, starter: h.starter, rating: h.rating, house: true, bio: h.bio }));
    if (player) rows.push({ id: 'me', name: player.name, starter: player.starter, rating: player.rating, house: false });
    rows.sort((a, b) => b.rating - a.rating || (a.house ? 1 : -1));
    rows.forEach((r, i) => { r.rank = i + 1; r.tier = tierOf(r.rating); });
    return rows;
  }

  // ====================================================================
  // Brain summary, for the brain page and for cards
  // ====================================================================
  const MOVE_SLOT_NAMES = ['Headbutt', 'Element move', 'Intimidate', 'Big move'];
  function moveName(species, slot) {
    const sp = E.SPECIES[species];
    return slot === 0 ? 'Headbutt' : slot === 1 ? sp.basic : slot === 2 ? 'Intimidate' : sp.ult;
  }
  function brainSummary(profile) {
    let habits = 0, samples = 0, taught = 0;
    const fav = [0, 0, 0, 0];
    for (let b = 0; b < E.BUCKETS; b++) {
      const n = E.bucketTotal(profile, b);
      if (!n) continue;
      taught++; samples += n;
      const h = E.habitInfo(profile, b, null);
      if (h.eligible) { habits++; fav[h.modal]++; }
    }
    let top = -1; for (let a = 0; a < 4; a++) if (fav[a] > 0 && (top < 0 || fav[a] > fav[top])) top = a;
    return { covered: profile.coveredCount, target: E.COVERAGE_TARGET, randomness: E.epsilonOf(profile), habits: habits, taught: taught, samples: samples, favorite: top, favCounts: fav };
  }
  function describeBucket(b) {
    const d = E.decodeBucket(b);
    return { own: E.OWN_LABELS[d.own], opp: E.OPP_LABELS[d.opp], rel: E.REL_LABELS[d.rel], phase: E.PHASE_LABELS[d.ph], d: d };
  }

  return {
    SEASON, SPECIES, START_RATING, K_FACTOR, MATCHES_PER_DAY, NAME_MAX, ROSTER, ROSTER_BY_ID, RATINGS, TIERS, MOVE_SLOT_NAMES,
    styleProfile, cleanName,
    studentRef, houseRef, refInfo, brainOf,
    encodeBrainCode, decodeBrainCode, encodeMatchCode, decodeMatchCode, findCode,
    matchOrder, gameSeed, createMatchGame, playMatch, verifyMatchCode,
    expectedScore, ratingDelta, tierOf, dailyOpponents, rankedSeed, standings,
    moveName, brainSummary, describeBucket
  };
});
