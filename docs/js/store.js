/*!
 * Capmon Arena save data. Everything lives in this browser (localStorage); there is no
 * server and no account. If storage is blocked the game still runs, with a save that
 * lasts until the tab closes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./game.js'));
  else root.CapmonStore = factory(root.CapmonEngine, root.CapmonGame);
})(typeof self !== 'undefined' ? self : this, function (E, G) {
  'use strict';
  const KEY = 'capmon-arena:v1';
  const LOG_MAX = 30, DAYS_KEPT = 10;

  let memory = null, persistent = true;
  function storage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function readRaw() {
    const ls = storage();
    if (ls) { try { return ls.getItem(KEY); } catch (e) { /* blocked */ } }
    persistent = false;
    return memory;
  }
  function writeRaw(text) {
    memory = text;
    const ls = storage();
    if (!ls) { persistent = false; return; }
    try { ls.setItem(KEY, text); persistent = true; } catch (e) { persistent = false; }
  }

  function randomId() {
    const b = new Uint8Array(6);
    try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 6; i++) b[i] = Math.floor(Math.random() * 256); }
    return 'p' + E.b64urlEncode(b);
  }
  /** Local calendar day, for example "2026-11-15". */
  function today(d) {
    d = d || new Date();
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function blank() {
    return {
      v: 1, id: randomId(), name: '', starter: 'Rageblaze', created: today(), onboarded: false,
      brain: E.profileCode(E.newProfile()), credits: { day: '', n: 0 },
      rating: G.START_RATING, peak: G.START_RATING, ranked: { played: 0, won: 0 },
      teach: { battles: 0, wins: 0, moves: 0, salt: 0 },
      days: {}, log: [],
      settings: { speed: 1, level: 'pebble', sound: true }
    };
  }
  /** Accepts whatever was stored and returns a usable state (never throws). */
  function repair(s) {
    const d = blank();
    if (!s || typeof s !== 'object' || s.v !== 1) return d;
    const out = d;
    if (typeof s.id === 'string' && /^[A-Za-z0-9_-]{4,24}$/.test(s.id)) out.id = s.id;
    out.name = s.name ? G.cleanName(s.name) : '';
    if (G.SPECIES.indexOf(s.starter) >= 0) out.starter = s.starter;
    if (typeof s.created === 'string') out.created = s.created.slice(0, 10);
    out.onboarded = !!s.onboarded && !!out.name;
    try { E.profileFromCode(s.brain); out.brain = s.brain; } catch (e) { /* keep a blank brain */ }
    if (s.credits && typeof s.credits.day === 'string') out.credits = { day: s.credits.day.slice(0, 10), n: Math.max(0, Math.min(E.DAILY_CAP, s.credits.n | 0)) };
    const num = (v, def, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def);
    out.rating = num(s.rating, G.START_RATING, 0, 4000);
    out.peak = Math.max(out.rating, num(s.peak, out.rating, 0, 4000));
    if (s.ranked) out.ranked = { played: num(s.ranked.played, 0, 0, 1e6), won: num(s.ranked.won, 0, 0, 1e6) };
    if (s.teach) out.teach = { battles: num(s.teach.battles, 0, 0, 1e6), wins: num(s.teach.wins, 0, 0, 1e6), moves: num(s.teach.moves, 0, 0, 1e7), salt: num(s.teach.salt, 0, 0, 1e9) };
    const okRec = r => r && typeof r === 'object' && typeof r.code === 'string' && r.code.length < 1700 && (r.me === 'A' || r.me === 'B');
    const cleanRec = r => ({ k: r.k === 'c' ? 'c' : 'r', day: String(r.day || '').slice(0, 10), code: r.code, me: r.me, won: !!r.won, score: String(r.score || '').slice(0, 5), opp: G.cleanName(r.opp), oppId: typeof r.oppId === 'string' ? r.oppId.slice(0, 16) : '', r0: num(r.r0, 0, 0, 4000), r1: num(r.r1, 0, 0, 4000), seen: !!r.seen, at: num(r.at, 0, 0, 1e13) });
    if (s.days && typeof s.days === 'object') {
      Object.keys(s.days).sort().slice(-DAYS_KEPT).forEach(k => {
        const day = s.days[k];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !day || !Array.isArray(day.opp)) return;
        const opp = day.opp.filter(id => G.ROSTER_BY_ID.hasOwnProperty(id)).slice(0, G.MATCHES_PER_DAY);
        if (opp.length !== G.MATCHES_PER_DAY) return;
        out.days[k] = { opp: opp, done: (Array.isArray(day.done) ? day.done : []).slice(0, G.MATCHES_PER_DAY).map(r => (okRec(r) ? cleanRec(r) : null)) };
      });
    }
    if (Array.isArray(s.log)) out.log = s.log.filter(okRec).slice(-LOG_MAX).map(cleanRec);
    if (s.settings) {
      out.settings.speed = [1, 2, 4].indexOf(s.settings.speed) >= 0 ? s.settings.speed : 1;
      out.settings.level = G.ROSTER_BY_ID.hasOwnProperty(s.settings.level) ? s.settings.level : 'pebble';
      out.settings.sound = s.settings.sound !== false;
    }
    return out;
  }

  function load() {
    let parsed = null;
    try { const raw = readRaw(); if (raw) parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    return repair(parsed);
  }
  function save(state) {
    const keys = Object.keys(state.days).sort();
    while (keys.length > DAYS_KEPT) delete state.days[keys.shift()];
    if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
    try { writeRaw(JSON.stringify(state)); } catch (e) { persistent = false; }
    return persistent;
  }
  function wipe() { memory = null; const ls = storage(); if (ls) { try { ls.removeItem(KEY); } catch (e) { /* ignore */ } } }

  /** The player's profile as a live object, with today's teaching credits restored. */
  function profileOf(state) {
    const p = E.profileFromCode(state.brain);
    p.creditsDay = state.credits.day; p.creditsToday = state.credits.n;
    return p;
  }
  function setProfile(state, p) {
    state.brain = E.profileCode(p);
    state.credits = { day: p.creditsDay || '', n: p.creditsToday || 0 };
  }

  return { KEY, load, save, wipe, repair, blank, today, profileOf, setProfile, isPersistent: () => persistent };
});
