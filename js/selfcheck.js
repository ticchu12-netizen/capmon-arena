/*!
 * Capmon Arena self-check.
 * Runs a fixed set of network evaluations and full games and reduces everything to one
 * hash. The same hash on two devices means they compute matches identically, which is
 * what makes a replay on someone else's phone meaningful. The expected value is written
 * to expected.js by tools/make_expected.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CapmonSelfCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function profileFor(E, seed, n) {
    const r = E.rngFrom(seed), p = E.newProfile();
    for (let k = 0; k < n; k++) {
      const b = Math.floor(r() * E.BUCKETS), fav = Math.floor(r() * 4), reps = 4 + Math.floor(r() * 10);
      for (let i = 0; i < reps; i++) E.recordTurn(p, b, r() < 0.8 ? fav : Math.floor(r() * 4), 'd' + (k % 9));
    }
    return p;
  }
  /** @returns {{hash:string, games:number, rounds:number, ms:number}} */
  function run(E, model, games) {
    const t0 = Date.now();
    const n = games || 12;
    const parts = [E.ENGINE_ID, model.id];
    const r = E.rngFrom('selfcheck|network');
    for (let i = 0; i < 8; i++) {
      const obs = new Array(192);
      for (let j = 0; j < 192; j++) obs[j] = r() * 2 - 0.5;
      parts.push(model.policy(obs, [1, 1, i % 3 ? 1 : 0, i % 2]).logits.join(','));
    }
    const grades = ['60M', '40M', '15M'];
    let rounds = 0;
    for (let g = 0; g < n; g++) {
      const a = g % 2 ? { kind: 'student', profile: profileFor(E, 'selfcheck|pa' + g, 30 + g * 5) } : { kind: 'house', grade: grades[g % 3] };
      const b = g % 3 === 0 ? { kind: 'student', profile: profileFor(E, 'selfcheck|pb' + g, 60) } : { kind: 'house', grade: grades[(g + 1) % 3] };
      const game = E.createGame({ seed: 'selfcheck|game' + g, a: { species: E.SPECIES_NAMES[g % 3], brain: a }, b: { species: E.SPECIES_NAMES[(g + (g % 2)) % 3], brain: b }, model: model }).run();
      rounds += game.round;
      parts.push(E.transcriptHash(game.transcript()));
      if (a.kind === 'student') parts.push(E.profileCode(a.profile));
    }
    return { hash: E.sha256Hex(parts.join('|')), games: n, rounds: rounds, ms: Date.now() - t0 };
  }
  return { run: run };
});
