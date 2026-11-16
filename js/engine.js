/*!
 * Capmon Arena engine
 *
 * The real Capmon battle, runnable anywhere (browser or Node), with every random
 * draw taken from seeded streams so a match can be replayed exactly.
 *
 * What is ported from where:
 *   - Battle rules ............ capbot-server/battleSim.js, itself a port of
 *                               BattleCharacter.cs + BattleUtils.cs (checked against
 *                               the C# source: damage formula, type chart, Intimidate
 *                               ramp, passives, stats, moves)
 *   - AI decision pipeline .... AIBrain.cs via battleSim.js: 192-input observation,
 *                               policy network, opponent model, 50-sample planner,
 *                               hard-coded override rules
 *   - Policy network .......... CapmonAI-57999998.onnx (ML-Agents PPO, about 58M
 *                               steps), executed here as plain arithmetic
 *   - Habit layer ............. StudentBrain design constants (108 buckets, capped
 *                               override, coverage-driven randomness)
 *
 * Determinism rules for this file:
 *   - No Math.random. Randomness comes only from the streams passed in or derived
 *     from the match seed.
 *   - No Math.exp / Math.pow / Math.log / Math.tanh. Their last-bit results are not
 *     fixed by the language spec and differ between browsers. dexp() below uses only
 *     + - * / which are exact IEEE-754 operations everywhere.
 *   - Fixed loop order in every sum.
 * The same seed and the same two brains therefore give the same match on every
 * device.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CapmonEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENGINE_ID = 'capmon-arena-engine/1';

  // ====================================================================
  // 1. Small utilities
  // ====================================================================
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  // ---- SHA-256 (synchronous, standard) ----
  const SHA_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function sha256(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = bytes.length;
    const total = Math.ceil((l + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(l / 0x20000000));
    dv.setUint32(total - 4, (l << 3) >>> 0);
    const W = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const w15 = W[i - 15], w2 = W[i - 2];
        const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA_K[i] + W[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }
  function toHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  const sha256Hex = input => toHex(sha256(typeof input === 'string' ? utf8(input) : input));

  // ---- base64url (no padding) ----
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64_REV = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
  function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      s += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
      if (i + 1 < bytes.length) s += B64[((b1 & 15) << 2) | (b2 >> 6)];
      if (i + 2 < bytes.length) s += B64[b2 & 63];
    }
    return s;
  }
  function b64urlDecode(str) {
    const s = String(str || '');
    const n = Math.floor(s.length * 3 / 4);
    const out = new Uint8Array(n);
    let acc = 0, bits = 0, o = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const v = c < 128 ? B64_REV[c] : -1;
      if (v < 0) throw new Error('bad base64url character at ' + i);
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return out.subarray(0, o);
  }

  // ====================================================================
  // 2. Seeded random streams
  // ====================================================================
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  /** A stream of numbers in [0, 1) fully determined by `seed`. */
  function rngFrom(seed) {
    const s = cyrb128(String(seed));
    const r = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 15; i++) r();
    return r;
  }

  // ====================================================================
  // 3. Deterministic exp / sigmoid / tanh
  // ====================================================================
  const LN2_HI = 6.93147180369123816490e-01;   // high bits of ln 2 (k * LN2_HI is exact for |k| < 2^20)
  const LN2_LO = 1.90821492927058770002e-10;   // ln 2 - LN2_HI
  const INV_LN2 = 1.44269504088896338700e+00;
  const INV_FACT = (() => { const t = new Float64Array(14); let f = 1; t[0] = 1; for (let n = 1; n < 14; n++) { f *= n; t[n] = 1 / f; } return t; })();
  const POW2_POS = (() => { const t = new Float64Array(1024); t[0] = 1; for (let i = 1; i < 1024; i++) t[i] = t[i - 1] * 2; return t; })();
  const POW2_NEG = (() => { const t = new Float64Array(1022); t[0] = 1; for (let i = 1; i < 1022; i++) t[i] = t[i - 1] / 2; return t; })();

  /** e^x from exact IEEE operations only (accurate to about 1e-15 relative). */
  function dexp(x) {
    if (x !== x) return NaN;
    if (x > 709) return Infinity;
    if (x < -707) return 0;
    const k = Math.round(x * INV_LN2);
    const r = (x - k * LN2_HI) - k * LN2_LO;      // |r| <= 0.347
    let p = INV_FACT[13];
    for (let n = 12; n >= 0; n--) p = p * r + INV_FACT[n];
    return k >= 0 ? p * POW2_POS[k] : p * POW2_NEG[-k];
  }
  function sigmoid(x) {
    if (x >= 0) return 1 / (1 + dexp(-x));
    const e = dexp(x);
    return e / (1 + e);
  }
  function dtanh(x) {
    if (x > 20) return 1;
    if (x < -20) return -1;
    const e2 = dexp(2 * x);
    return (e2 - 1) / (e2 + 1);
  }

  // ====================================================================
  // 4. Policy network (plain-arithmetic execution of the ONNX model)
  // ====================================================================
  const OBS = 192, HID = 512, LSTM_H = 256, N_MOVES = 4;
  const MODEL_FLOATS = 2 * OBS + (HID * OBS + HID) + 2 * (HID * HID + HID) + 3 * (LSTM_H * HID) + 3 * LSTM_H + (N_MOVES * LSTM_H + N_MOVES);

  /**
   * @param {ArrayBuffer|Uint8Array} data contents of brain.bin
   * @returns {{ policy(obs:number[], mask:number[]): {action:number, logits:number[], probs:number[]}, id:string }}
   */
  function createModel(data) {
    let bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < 16 || bytes[0] !== 0x43 || bytes[1] !== 0x41 || bytes[2] !== 0x50 || bytes[3] !== 0x42) throw new Error('brain.bin: bad magic');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = dv.getUint32(4, true), n = dv.getUint32(8, true);
    if (version !== 1) throw new Error('brain.bin: unsupported version ' + version);
    if (n !== MODEL_FLOATS || bytes.length !== 16 + 4 * n) throw new Error('brain.bin: unexpected size');
    const id = sha256Hex(bytes);
    // Copy into an aligned, native-endian Float32Array (works on any platform).
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = dv.getFloat32(16 + 4 * i, true);
    let o = 0;
    const take = len => { const v = f.subarray(o, o + len); o += len; return v; };
    const mean = take(OBS), div = take(OBS);
    const W0 = take(HID * OBS), b0 = take(HID), W1 = take(HID * HID), b1 = take(HID), W2 = take(HID * HID), b2 = take(HID);
    const Wi = take(LSTM_H * HID), Wo = take(LSTM_H * HID), Wg = take(LSTM_H * HID);
    const bi = take(LSTM_H), bo = take(LSTM_H), bg = take(LSTM_H);
    const HW = take(N_MOVES * LSTM_H), hb = take(N_MOVES);

    const x0 = new Float64Array(OBS), h1 = new Float64Array(HID), h2 = new Float64Array(HID), h3 = new Float64Array(HID), hl = new Float64Array(LSTM_H);

    function dense(W, b, x, nIn, nOut, out) {
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        const base = j * nIn;
        for (let i = 0; i < nIn; i++) s += W[base + i] * x[i];
        out[j] = s * sigmoid(s);                     // swish
      }
    }

    function policy(obs, mask) {
      for (let i = 0; i < OBS; i++) {
        const v = (Math.fround(obs[i]) - mean[i]) / div[i];   // inputs are float32 in the game
        x0[i] = v < -5 ? -5 : v > 5 ? 5 : v;
      }
      dense(W0, b0, x0, OBS, HID, h1);
      dense(W1, b1, h1, HID, HID, h2);
      dense(W2, b2, h2, HID, HID, h3);
      // One LSTM step from a zero state: c = i * g, h = o * tanh(c).
      for (let j = 0; j < LSTM_H; j++) {
        let si = bi[j], so = bo[j], sg = bg[j];
        const base = j * HID;
        for (let i = 0; i < HID; i++) { const v = h3[i]; si += Wi[base + i] * v; so += Wo[base + i] * v; sg += Wg[base + i] * v; }
        hl[j] = sigmoid(so) * dtanh(sigmoid(si) * dtanh(sg));
      }
      const logits = [0, 0, 0, 0];
      for (let a = 0; a < N_MOVES; a++) {
        let s = hb[a];
        const base = a * LSTM_H;
        for (let j = 0; j < LSTM_H; j++) s += HW[base + j] * hl[j];
        logits[a] = s;
      }
      // Masked arg-max. First index wins a tie, as in ONNX ArgMax.
      let action = -1, top = -Infinity;
      for (let a = 0; a < N_MOVES; a++) if (mask[a] && logits[a] > top) { top = logits[a]; action = a; }
      const probs = [0, 0, 0, 0];
      if (action < 0) { action = 0; }                 // nothing usable: the ONNX graph also returns index 0
      else {
        let z = 0;
        for (let a = 0; a < N_MOVES; a++) if (mask[a]) { probs[a] = dexp(logits[a] - top); z += probs[a]; }
        for (let a = 0; a < N_MOVES; a++) probs[a] /= z;
      }
      return { action, logits, probs };
    }
    return { policy, id };
  }

  // ====================================================================
  // 5. Battle rules (port of BattleCharacter.cs / BattleUtils.cs via battleSim.js)
  // ====================================================================
  const TYPE = { FIRE: 0, WATER: 1, GRASS: 2, NORMAL: 3 };
  const TYPE_NAME = ['Fire', 'Water', 'Grass', 'Normal'];

  const SPECIES = {
    Rageblaze: { type: TYPE.FIRE,  maxHP: 380, attack: 105, defense: 55, speed: 115, basic: 'Ember',     ult: 'Fire Blaze' },
    Tsunami:   { type: TYPE.WATER, maxHP: 400, attack: 85,  defense: 80, speed: 75,  basic: 'Watergun',  ult: 'Hydroblast' },
    Healspike: { type: TYPE.GRASS, maxHP: 350, attack: 90,  defense: 60, speed: 100, basic: 'Vine Whip', ult: 'Leaf Storm' }
  };
  const SPECIES_NAMES = ['Rageblaze', 'Tsunami', 'Healspike'];

  // Five moves per creature. Slot 4 (Heal) starts with 0 PP and is never usable here.
  function makeMoves(sp) {
    return [
      { name: 'Headbutt',   type: TYPE.NORMAL, power: 30, pp: -1, isStatus: false },
      { name: sp.basic,     type: sp.type,     power: 30, pp: -1, isStatus: false },
      { name: 'Intimidate', type: TYPE.NORMAL, power: 0,  pp: -1, isStatus: true },
      { name: sp.ult,       type: sp.type,     power: 60, pp: 1,  isStatus: false },
      { name: 'Heal',       type: TYPE.NORMAL, power: 0,  pp: 0,  isStatus: true }
    ];
  }

  function createFighter(speciesName) {
    const sp = SPECIES[speciesName];
    if (!sp) throw new Error('unknown species: ' + speciesName);
    return {
      species: speciesName, type: sp.type,
      maxHP: sp.maxHP, currentHP: sp.maxHP,
      attack: sp.attack,
      defense: sp.defense, baseDefense: sp.defense,
      speed: sp.speed, baseSpeed: sp.speed,
      defenseStage: 0,
      defenseDebuffPercentage: 0,
      speedDebuffPercentage: 0,
      intimidateCount: 0,
      moves: makeMoves(sp),
      lastUsedMove: null,
      lastWasCrit: false,
      isDefeated: false
    };
  }

  function getTypeEffectiveness(attackType, defType) {
    if (attackType === defType) return 1;
    if (attackType === TYPE.FIRE)  { if (defType === TYPE.GRASS) return 1.05; if (defType === TYPE.WATER) return 0.8; }
    if (attackType === TYPE.WATER) { if (defType === TYPE.FIRE)  return 1.05; if (defType === TYPE.GRASS) return 0.8; }
    if (attackType === TYPE.GRASS) { if (defType === TYPE.WATER) return 1.05; if (defType === TYPE.FIRE)  return 0.8; }
    return 1;
  }

  function getDefenseMultiplier(ch) {
    if (ch.defenseStage >= 0) return (2 + ch.defenseStage) / 2;
    return 2 / (2 + -ch.defenseStage);
  }

  // Two draws per damaging move, in this order: critical hit, then the 217..255 damage roll.
  function calculateDamage(attacker, defender, move, rng) {
    if (move.power === 0) return { damage: 0, isCritical: false };
    const baseDamage = (move.power * attacker.attack) / (defender.defense * getDefenseMultiplier(defender));
    const typeEff = getTypeEffectiveness(move.type, defender.type);
    const stab = (move.type === attacker.type) ? 1.05 : 1;
    const critChance = (move.name === 'Headbutt') ? 0.15 : 0.1;
    const isCritical = rng() < critChance;
    const crit = isCritical ? 1.5 : 1;
    const totalModifier = typeEff * stab * crit;
    const randomNum = Math.floor(rng() * 39) + 217;   // 217..255 inclusive
    const randomFactor = randomNum / 255;
    const damage = Math.floor(baseDamage * totalModifier * randomFactor);
    return { damage, isCritical };
  }

  function applyDamage(ch, dmg) {
    ch.currentHP -= dmg;
    if (ch.currentHP <= 0) { ch.currentHP = 0; ch.isDefeated = true; }
  }
  function applyHeal(ch, amount) {
    ch.currentHP += amount;
    if (ch.currentHP > ch.maxHP) ch.currentHP = ch.maxHP;
  }
  function applyDefenseChange(ch, newDef) { ch.defense = Math.min(newDef, ch.baseDefense * 3); }
  function applySpeedChange(ch, newSpd) { ch.speed = Math.min(newSpd, ch.baseSpeed * 3); }

  function applyMoveEffect(user, target, move) {
    if (move.name === 'Intimidate') {
      if (target.defenseDebuffPercentage < 65) {
        target.intimidateCount++;
        let debuffAmount = 9 + target.intimidateCount;        // 10, 11, 12 ...
        if (target.type === TYPE.FIRE) {
          // Fire only: 1% steps once the defense actually lost reaches 65%
          const effectiveDebuffPct = (target.baseDefense - target.defense) / target.baseDefense * 100;
          if (effectiveDebuffPct >= 65) debuffAmount = 1;
        } else {
          if (target.defenseDebuffPercentage >= 65) debuffAmount = 1;
        }
        target.defenseDebuffPercentage += debuffAmount;
        if (target.defenseDebuffPercentage > 65) target.defenseDebuffPercentage = 65;
        const newDef = Math.floor(target.baseDefense * (1 - target.defenseDebuffPercentage / 100));
        applyDefenseChange(target, newDef);
      }
    } else if (move.name === 'Heal') {
      applyHeal(user, Math.floor(user.maxHP * 0.25));
    }
  }

  /** End-of-round passive. Returns what happened so the caller can show it. */
  function applyPassive(ch) {
    if (ch.isDefeated) return null;
    if (ch.type === TYPE.GRASS) {
      const heal = Math.floor(ch.maxHP * 0.05);
      if (heal > 0) { const before = ch.currentHP; applyHeal(ch, heal); return { kind: 'heal', amount: ch.currentHP - before }; }
    } else if (ch.type === TYPE.WATER) {
      const inc = Math.floor(ch.baseSpeed * 0.05);
      if (inc > 0) { const before = ch.speed; applySpeedChange(ch, ch.speed + inc); return { kind: 'speed', amount: ch.speed - before }; }
    } else if (ch.type === TYPE.FIRE) {
      const inc = Math.floor(ch.baseDefense * 0.05);
      if (inc > 0) { const before = ch.defense; applyDefenseChange(ch, ch.defense + inc); return { kind: 'defense', amount: ch.defense - before }; }
    }
    return null;
  }

  function isMoveUsable(ch, idx) {
    if (idx < 0 || idx >= ch.moves.length) return false;
    const m = ch.moves[idx];
    return m.pp === -1 || m.pp > 0;
  }
  function usableMoves(ch) { const v = []; for (let i = 0; i < 4; i++) if (isMoveUsable(ch, i)) v.push(i); return v; }

  // AIBrain.GetMoveIdx. Note: the big move is typed, so it lands on index 1 here, exactly as in the game.
  function getMoveIdx(move) {
    if (!move) return -1;
    if (move.name === 'Headbutt') return 0;
    if (move.type === TYPE.FIRE || move.type === TYPE.WATER || move.type === TYPE.GRASS) return 1;
    if (move.name === 'Intimidate') return 2;
    return 3;
  }

  /** Applies a move. Returns what the UI and the transcript need. */
  function executeMove(actor, target, moveIdx, rng) {
    const move = actor.moves[moveIdx];
    const hpBefore = target.currentHP, defBefore = target.defense, debuffBefore = target.defenseDebuffPercentage;
    actor.lastUsedMove = move;
    if (move.pp > 0) move.pp--;
    let raw = 0;
    if (move.power > 0) {
      const r = calculateDamage(actor, target, move, rng);
      actor.lastWasCrit = r.isCritical;
      raw = r.damage;
      applyDamage(target, r.damage);
    } else {
      actor.lastWasCrit = false;
    }
    applyMoveEffect(actor, target, move);
    return {
      mi: moveIdx, name: move.name, moveType: move.type,
      raw, dmg: hpBefore - target.currentHP, crit: actor.lastWasCrit,
      defDrop: defBefore - target.defense,
      debuffAdded: target.defenseDebuffPercentage - debuffBefore,
      maxed: move.name === 'Intimidate' && debuffBefore >= 65,
      ko: target.isDefeated
    };
  }

  // ====================================================================
  // 6. AI state and pipeline (port of AIBrain.cs via battleSim.js)
  // ====================================================================
  function createAiState() {
    return {
      oppMoveProbs: [0.25, 0.25, 0.25, 0.25],
      oppPPEstimates: [1, 1, 1, 1],
      oppTypeProbs: [0.33, 0.33, 0.34],           // Fire, Water, Grass
      obsQueue: [],
      currentTurn: 0,
      hasUsedUlt: false
    };
  }

  function updateOppModel(ai, oppLastMove) {
    if (!oppLastMove) return;
    const idx = getMoveIdx(oppLastMove);
    if (idx < 0) return;
    ai.oppMoveProbs[idx] += 0.1;
    let sum = 0;
    for (let m = 0; m < 4; m++) sum += ai.oppMoveProbs[m];
    for (let m = 0; m < 4; m++) ai.oppMoveProbs[m] /= sum;
  }
  function updateOppPPEstimates(ai, oppLastMove) {
    if (!oppLastMove) return;
    const idx = getMoveIdx(oppLastMove);
    if (idx < 0) return;
    ai.oppPPEstimates[idx] = Math.max(0, ai.oppPPEstimates[idx] - 0.2);
  }
  function updateOppTypeProbs(ai, opp) {
    if (!opp.lastUsedMove) return;
    let priorSum = 0;
    for (let t = 0; t < 3; t++) priorSum += ai.oppTypeProbs[t];
    for (let t = 0; t < 3; t++) {
      const lh = getTypeEffectiveness(opp.lastUsedMove.type, t);
      ai.oppTypeProbs[t] = (ai.oppTypeProbs[t] * lh) / priorSum;
    }
    let newSum = 0;
    for (let t = 0; t < 3; t++) newSum += ai.oppTypeProbs[t];
    for (let t = 0; t < 3; t++) ai.oppTypeProbs[t] /= newSum;
  }
  function estimateCritProb(ch) {
    if (!ch.moves || ch.moves.length === 0) return 0;
    let s = 0;
    for (const m of ch.moves) s += m.power > 50 ? 0.1 : 0.05;
    return s / ch.moves.length;
  }
  function estimatePassiveValue(type) {
    if (type === TYPE.GRASS || type === TYPE.WATER || type === TYPE.FIRE) return 0.05;
    return 0;
  }

  // One 64-value frame per decision; the network sees the last three, oldest first.
  function buildObservation(ai, self, opp) {
    const obs = new Array(64).fill(0);
    let i = 0;
    obs[i++] = self.currentHP / self.maxHP;
    obs[i++] = self.speed / 150;
    obs[i++] = self.defense / 150;
    obs[i++] = self.intimidateCount / 10;
    obs[i++] = self.defenseDebuffPercentage / 100;
    obs[i++] = self.speedDebuffPercentage / 100;
    obs[i++] = opp.currentHP / opp.maxHP;
    obs[i++] = opp.speed / 150;
    obs[i++] = opp.defense / 150;
    obs[i++] = opp.defenseDebuffPercentage / 100;
    for (let m = 0; m < 4; m++) {
      const move = self.moves[m];
      obs[i++] = (move.pp > 0 || move.pp === -1) ? 1 : 0;
      let p = move.power / 100;
      if (move.name === 'Intimidate') p = opp.defenseDebuffPercentage < 75 ? 0.6 : 0.05;
      const stab = move.type === self.type ? 1.05 : 1;
      const eff = getTypeEffectiveness(move.type, opp.type);
      obs[i++] = p * stab * eff;
      obs[i++] = move.isStatus ? 1 : 0;
    }
    for (let m = 0; m < 4; m++) {
      const move = self.moves[m];
      obs[i++] = (move.pp === -1) ? 1 : move.pp / 1;
    }
    obs[i++] = self.speed >= opp.speed ? 1 : 0;
    obs[i++] = ai.currentTurn / 50;

    updateOppTypeProbs(ai, opp);
    obs[i++] = ai.oppTypeProbs[TYPE.FIRE];
    obs[i++] = ai.oppTypeProbs[TYPE.WATER];
    obs[i++] = ai.oppTypeProbs[TYPE.GRASS];

    for (let j = 0; j < 4; j++) obs[i++] = (self.lastUsedMove && getMoveIdx(self.lastUsedMove) === j) ? 1 : 0;
    for (let j = 0; j < 4; j++) obs[i++] = (opp.lastUsedMove && getMoveIdx(opp.lastUsedMove) === j) ? 1 : 0;
    for (let j = 0; j < 3; j++) obs[i++] = (self.type === j) ? 1 : 0;
    for (let j = 0; j < 3; j++) obs[i++] = (opp.type === j) ? 1 : 0;
    obs[i++] = estimateCritProb(self);
    obs[i++] = estimatePassiveValue(self.type);

    ai.obsQueue.push(obs);
    if (ai.obsQueue.length > 3) ai.obsQueue.shift();
    const stacked = new Array(OBS).fill(0);
    let offset = (3 - ai.obsQueue.length) * 64;
    for (let k = 0; k < ai.obsQueue.length; k++) {
      const frame = ai.obsQueue[k];
      for (let z = 0; z < 64; z++) stacked[offset + z] = frame[z];
      offset += 64;
    }
    return stacked;
  }

  // AIBrain.SimulateDamage: a rough, non-mutating estimate. One draw when the move does damage.
  function simulateDamage(attacker, defender, move, applyPassiveSim, rng) {
    let simDefDebuff = defender.defenseDebuffPercentage;
    let simDef = defender.defense * (1 - simDefDebuff / 100);
    if (move.name === 'Intimidate' && simDefDebuff < 75) {
      simDefDebuff = Math.min(simDefDebuff + 10, 75);
      simDef = defender.baseDefense * (1 - simDefDebuff / 100);
    }
    let damage = 0;
    if (move.power > 0) {
      const typeEff = getTypeEffectiveness(move.type, defender.type);
      const stab = (move.type === attacker.type) ? 1.05 : 1;
      const crit = rng() < 0.05 ? 1.5 : 1;
      damage = (move.power * attacker.attack / Math.max(simDef, 1)) * typeEff * stab * crit;
    }
    if (applyPassiveSim) {
      if (attacker.type === TYPE.GRASS) damage += attacker.maxHP * 0.05;
      else if (attacker.type === TYPE.WATER || attacker.type === TYPE.FIRE) damage *= 1.05;
    }
    return damage;
  }

  function sampleOppMove(ai, rng) {
    const r = rng();
    let s = 0;
    for (let m = 0; m < 4; m++) {
      s += ai.oppMoveProbs[m] * ai.oppPPEstimates[m];
      if (r < s) return m;
    }
    return 0;
  }

  // AIBrain.MCTSPlanning: 50 samples per move, score = my damage - their damage + policy bias.
  const PLANNER_SIMS = 50;
  function planMove(ai, self, opp, rlProbs, rng) {
    const scores = [0, 0, 0, 0];
    const typeAdv = getTypeEffectiveness(self.type, opp.type) - getTypeEffectiveness(opp.type, self.type);
    for (let m = 0; m < 4; m++) {
      let total = 0;
      for (let sim = 0; sim < PLANNER_SIMS; sim++) {
        const oppMoveIdx = sampleOppMove(ai, rng);
        const myDmg = simulateDamage(self, opp, self.moves[m], true, rng);
        const oppDmg = simulateDamage(opp, self, opp.moves[oppMoveIdx], false, rng);
        let s = (myDmg - oppDmg) + rlProbs[m] * 20;
        if (m === 2 && typeAdv < 0) s += 5;
        if (oppDmg < opp.currentHP * 0.3) s += estimatePassiveValue(opp.type) * -2;
        total += s;
      }
      scores[m] = total / PLANNER_SIMS;
    }
    let best = 0;
    for (let m = 1; m < 4; m++) if (scores[m] > scores[best]) best = m;
    return { pick: best, scores };
  }

  // The hard-coded rule chain from AIBrain.ChooseMove. Only one branch is ever entered.
  function applyRules(ai, self, opp, bestMove, rng) {
    const oppHpNorm = opp.currentHP / opp.maxHP;
    const debuffPct = opp.defenseDebuffPercentage;
    const typeAdv = getTypeEffectiveness(self.type, opp.type) - getTypeEffectiveness(opp.type, self.type);
    let name = null, pick = bestMove, setUlt = false;
    if (!ai.hasUsedUlt && isMoveUsable(self, 3) && ai.currentTurn > 5) {
      const ultDmg = simulateDamage(self, opp, self.moves[3], false, rng);
      const isOneShot = opp.currentHP <= ultDmg;
      const nearEnd = opp.currentHP <= ultDmg + 30;
      if (isOneShot || nearEnd || (self.currentHP / self.maxHP) < 0.4) {
        pick = 3; ai.hasUsedUlt = true; setUlt = true;
        name = isOneShot || nearEnd ? 'BIG_MOVE_TO_FINISH' : 'BIG_MOVE_WHEN_LOW';
      }
    } else if (isMoveUsable(self, 3) && oppHpNorm <= 0.30 && debuffPct >= 40) {
      pick = 3; name = 'BIG_MOVE_SAVED_FOR_FINISH';
    } else if (typeAdv < 0 && debuffPct < 55) {
      pick = 2; name = 'INTIMIDATE_WHEN_OUTMATCHED';
    } else if (debuffPct >= 55) {
      const estDmg = simulateDamage(self, opp, self.moves[1], false, rng);
      if (estDmg >= opp.currentHP) { pick = 1; name = 'TYPED_MOVE_FOR_KO'; }
    } else {
      const typeEff = getTypeEffectiveness(self.moves[1].type, opp.type);
      if (typeEff > 1) { pick = 1; name = 'TYPED_MOVE_WITH_ADVANTAGE'; }
    }
    return { name, pick, changed: pick !== bestMove, setUlt };
  }

  // ====================================================================
  // 7. Habit layer (StudentBrain design)
  // ====================================================================
  const BUCKETS = 108;          // ownHP(4) x oppHP(3) x typeRelation(3) x phase(3)
  const ACTIONS = 5;            // five move slots, as in the game (slot 4 is never used here)
  const EPS_BIRTH = 0.40;       // randomness of an untaught brain
  const EPS_FLOOR = 0.20;       // randomness of a fully covered brain
  const COVERAGE_TARGET = 60;   // covered situations needed to reach the floor
  const DAILY_CAP = 8;          // new situations a brain can cover per day
  const OVERRIDE_CAP = 0.35;    // most a habit can override the model
  const MIN_BUCKET = 5;         // samples before a habit can act
  const MIN_COVER = 3;          // samples before a situation counts as covered
  const BUCKET_MEMORY = 24;     // samples kept per situation, so a brain can be re-taught

  const OWN_LABELS = ['0-25%', '26-50%', '51-75%', '76-100%'];
  const OPP_LABELS = ['0-33%', '34-66%', '67-100%'];
  const PHASE_LABELS = ['Rounds 1-3', 'Rounds 4-8', 'Round 9+'];
  const REL_LABELS = ['advantage', 'even', 'disadvantage'];

  function newProfile() {
    return { counts: new Array(BUCKETS * ACTIONS).fill(0), covered: new Array(BUCKETS).fill(false), coveredCount: 0, creditsToday: 0, creditsDay: '' };
  }
  const hpBand4 = f => (f > 0.75 ? 3 : f > 0.5 ? 2 : f > 0.25 ? 1 : 0);
  const hpBand3 = f => (f > 0.66 ? 2 : f > 0.33 ? 1 : 0);
  function typeRelation(selfType, oppType) {
    const mine = getTypeEffectiveness(selfType, oppType), theirs = getTypeEffectiveness(oppType, selfType);
    return mine > theirs ? 0 : theirs > mine ? 2 : 1;
  }
  /** The situation a decision is made in. `round` is 1-based. */
  function bucketOf(self, opp, round) {
    const own = hpBand4(self.currentHP / Math.max(1, self.maxHP));
    const ob = hpBand3(opp.currentHP / Math.max(1, opp.maxHP));
    const rel = typeRelation(self.type, opp.type);
    const ph = round <= 3 ? 0 : round <= 8 ? 1 : 2;
    return ((own * 3 + ob) * 3 + rel) * 3 + ph;
  }
  function decodeBucket(b) {
    const ph = b % 3; b = (b - ph) / 3;
    const rel = b % 3; b = (b - rel) / 3;
    const opp = b % 3;
    const own = (b - opp) / 3;
    return { own, opp, rel, ph };
  }
  function bucketTotal(p, b) { let t = 0; for (let a = 0; a < ACTIONS; a++) t += p.counts[b * ACTIONS + a]; return t; }

  /**
   * Logs one of the trainer's choices. Returns true when this sample made the
   * situation count as covered (at most DAILY_CAP of those per `day`).
   */
  function recordTurn(p, b, action, day) {
    if (p.creditsDay !== day) { p.creditsDay = day; p.creditsToday = 0; }
    const base = b * ACTIONS;
    if (bucketTotal(p, b) >= BUCKET_MEMORY) {
      // Memory is full: the new choice replaces one sample of the most common other move.
      let other = -1, oc = 0;
      for (let a = 0; a < ACTIONS; a++) if (a !== action && p.counts[base + a] > oc) { oc = p.counts[base + a]; other = a; }
      if (other >= 0) { p.counts[base + other]--; p.counts[base + action]++; }
    } else {
      p.counts[base + action]++;
    }
    if (!p.covered[b] && bucketTotal(p, b) >= MIN_COVER && p.creditsToday < DAILY_CAP) {
      p.covered[b] = true; p.coveredCount++; p.creditsToday++;
      return true;
    }
    return false;
  }
  function epsilonOf(p) {
    const t = clamp(p.coveredCount / COVERAGE_TARGET, 0, 1);
    return EPS_BIRTH + (EPS_FLOOR - EPS_BIRTH) * t;
  }
  /** What the trainer's habit says for situation `b`, and whether it may act. */
  function habitInfo(p, b, self) {
    let total = 0, modal = -1, mc = -1;
    for (let a = 0; a < 4; a++) { const c = p.counts[b * ACTIONS + a]; total += c; if (c > mc) { mc = c; modal = a; } }
    total += p.counts[b * ACTIONS + 4];
    const h = { bucket: b, n: total, modal, modalCount: mc, share: total ? mc / total : 0, eligible: false, p: 0, why: null };
    if (total < MIN_BUCKET) { h.why = 'few'; return h; }
    if (h.share < 0.5) { h.why = 'split'; return h; }
    if (self && !isMoveUsable(self, modal)) { h.why = 'used'; return h; }
    h.eligible = true;
    h.p = Math.min(OVERRIDE_CAP, 0.5 * h.share);
    return h;
  }

  // ---- profile codes: a brain as a short string ----
  // byte 0: format version (1)
  // 14 bytes: which situations are covered (108 bits)
  // 14 bytes: which situations have any samples (108 bits)
  // then 20 bits per non-empty situation: four counts of 5 bits (moves 0..3), packed MSB first
  const PROFILE_VERSION = 1;
  function encodeProfile(p) {
    const bits = [];
    const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    for (let b = 0; b < BUCKETS; b++) push(p.covered[b] ? 1 : 0, 1);
    push(0, 4);
    const nonEmpty = [];
    for (let b = 0; b < BUCKETS; b++) {
      let t = 0;
      for (let a = 0; a < 4; a++) t += p.counts[b * ACTIONS + a];
      nonEmpty.push(t > 0);
      push(t > 0 ? 1 : 0, 1);
    }
    push(0, 4);
    for (let b = 0; b < BUCKETS; b++) if (nonEmpty[b]) for (let a = 0; a < 4; a++) push(Math.min(31, p.counts[b * ACTIONS + a]), 5);
    while (bits.length % 8) bits.push(0);
    const out = new Uint8Array(1 + bits.length / 8);
    out[0] = PROFILE_VERSION;
    for (let i = 0; i < bits.length; i++) if (bits[i]) out[1 + (i >> 3)] |= 0x80 >> (i & 7);
    return out;
  }
  function decodeProfile(bytes) {
    if (!bytes || bytes.length < 29 || bytes[0] !== PROFILE_VERSION) throw new Error('unknown brain code');
    let pos = 8;
    const read = n => { let v = 0; for (let i = 0; i < n; i++) { const byte = bytes[pos >> 3]; if (byte === undefined) throw new Error('brain code is cut short'); v = (v << 1) | ((byte >> (7 - (pos & 7))) & 1); pos++; } return v; };
    const p = newProfile();
    for (let b = 0; b < BUCKETS; b++) { p.covered[b] = read(1) === 1; if (p.covered[b]) p.coveredCount++; }
    read(4);
    const nonEmpty = [];
    for (let b = 0; b < BUCKETS; b++) nonEmpty.push(read(1) === 1);
    read(4);
    for (let b = 0; b < BUCKETS; b++) if (nonEmpty[b]) for (let a = 0; a < 4; a++) p.counts[b * ACTIONS + a] = read(5);
    return p;
  }
  const profileCode = p => b64urlEncode(encodeProfile(p));
  const profileFromCode = code => decodeProfile(b64urlDecode(code));
  const profileHash = p => sha256Hex(encodeProfile(p));

  // ====================================================================
  // 8. Brains: what stands between the model and the move
  // ====================================================================
  // House grades. The 60M grade is the game's full AI (AIBrain): model, planner, rules, no randomness.
  const GRADES = {
    '60M': { mcts: true,  overrides: true,  eps: 0 },
    '40M': { mcts: false, overrides: true,  eps: 0.10 },
    '15M': { mcts: false, overrides: false, eps: 0.25 }
  };
  function gradeOf(brain) {
    if (brain.kind === 'house') {
      const g = GRADES[brain.grade];
      if (!g) throw new Error('unknown house grade: ' + brain.grade);
      return g;
    }
    if (brain.kind === 'student') return { mcts: false, overrides: false, eps: epsilonOf(brain.profile), style: true };
    // Free-form brain, for house characters and experiments: any mix of the layers.
    if (brain.kind === 'spec') return { mcts: !!brain.mcts, overrides: !!brain.overrides, eps: brain.eps == null ? (brain.profile ? epsilonOf(brain.profile) : 0) : brain.eps, style: !!brain.profile };
    throw new Error('brain kind cannot decide: ' + brain.kind);
  }
  function brainTag(brain) {
    if (brain.kind === 'house') return 'house:' + brain.grade;
    if (brain.kind === 'student') return 'student:' + profileHash(brain.profile).slice(0, 16);
    if (brain.kind === 'spec') return 'spec:' + sha256Hex([brain.mcts ? 1 : 0, brain.overrides ? 1 : 0, brain.eps == null ? 'auto' : brain.eps, brain.profile ? profileHash(brain.profile) : '-'].join('|')).slice(0, 16);
    return 'human';
  }

  /**
   * One decision. Order mirrors AIBrain: model (+ planner) -> rules -> habit -> random.
   * Draws from `rng` in exactly that order. Returns everything needed to explain the move.
   */
  function decide(brain, ai, self, opp, round, model, rng) {
    const g = gradeOf(brain);
    // --- AIBrain bookkeeping ---
    if (opp.lastUsedMove) { updateOppModel(ai, opp.lastUsedMove); updateOppPPEstimates(ai, opp.lastUsedMove); }
    ai.currentTurn++;
    const valid = usableMoves(self);
    const d = { round, bucket: bucketOf(self, opp, round), probs: null, modelPick: 0, final: 0, src: 'MODEL' };
    if (valid.length === 0) { d.probs = [0, 0, 0, 0]; return d; }   // cannot happen: Headbutt has unlimited PP

    // --- policy network ---
    const stacked = buildObservation(ai, self, opp);
    const mask = [isMoveUsable(self, 0) ? 1 : 0, isMoveUsable(self, 1) ? 1 : 0, isMoveUsable(self, 2) ? 1 : 0, isMoveUsable(self, 3) ? 1 : 0];
    const pol = model.policy(stacked, mask);
    d.probs = pol.probs;
    d.modelPick = pol.action;
    let pick = pol.action;

    // --- planner (the game feeds it a one-hot of the model's pick) ---
    if (g.mcts) {
      const rl = [0, 0, 0, 0];
      rl[pol.action] = 1;
      for (let i = 0; i < 4; i++) if (!isMoveUsable(self, i)) rl[i] = 0;
      d.mcts = planMove(ai, self, opp, rl, rng);
      pick = d.mcts.pick;
      d.src = 'MCTS';
    }
    // --- hard-coded rules ---
    let ruleSetUlt = false;
    if (g.overrides) {
      const r = applyRules(ai, self, opp, pick, rng);
      ruleSetUlt = r.setUlt;
      if (r.name) { d.rule = { name: r.name, pick: r.pick, changed: r.changed }; if (r.changed) d.src = 'RULE'; }
      pick = r.pick;
    }
    if (!isMoveUsable(self, pick)) pick = valid[0];

    // --- trainer's habit ---
    if (g.style) {
      const h = habitInfo(brain.profile, d.bucket, self);
      if (h.eligible) {
        h.roll = rng();
        h.fired = h.roll < h.p;
        if (h.fired) { h.agreed = h.modal === pick; pick = h.modal; d.src = 'HABIT'; }
      }
      d.habit = h;
    }
    // --- randomness ---
    if (g.eps > 0) {
      const roll = rng();
      d.random = { eps: g.eps, roll, fired: roll < g.eps };
      if (d.random.fired) { pick = valid[Math.floor(rng() * valid.length)]; d.random.pick = pick; d.src = 'RANDOM'; }
    }
    // The "big move used" flag must describe what was actually played.
    if (ruleSetUlt && pick !== 3) ai.hasUsedUlt = false;
    d.final = pick;
    return d;
  }

  // ====================================================================
  // 9. A game
  // ====================================================================
  const DEFAULT_RULES = {
    // 'simultaneous': both sides pick at the start of the round (the Unity game's rule).
    // 'sequential':   each side picks just before it acts (the server engine's behaviour; used to test this port).
    commit: 'simultaneous',
    // 'coin':  a seeded coin flip settles equal speed each round, and an exact tie on time-out.
    // 'sideA': side A wins speed ties and side B wins an exact time-out tie (the server engine's behaviour).
    tie: 'coin',
    maxRounds: 50
  };

  function snapshot(f) {
    return {
      hp: f.currentHP, maxHP: f.maxHP, def: f.defense, baseDef: f.baseDefense, spd: f.speed, baseSpd: f.baseSpeed,
      debuff: f.defenseDebuffPercentage, intimidated: f.intimidateCount, pp: [f.moves[0].pp, f.moves[1].pp, f.moves[2].pp, f.moves[3].pp]
    };
  }

  /**
   * @param {object} opts
   *   seed   string. Fixes every random draw of the game.
   *   a, b   { species, brain } where brain is
   *            { kind: 'house', grade: '60M' | '40M' | '15M' }
   *            { kind: 'student', profile }
   *            { kind: 'human', shadow?: brain }   moves are passed to playRound(); `shadow` also asks a brain for advice each round
   *   model  from createModel()
   *   rules  optional overrides of DEFAULT_RULES
   *   rng    optional { mech, a, b } streams (tests only)
   */
  function createGame(opts) {
    const rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
    const seed = String(opts.seed);
    const model = opts.model;
    const streams = opts.rng || { mech: rngFrom(seed + '|mech'), a: rngFrom(seed + '|a'), b: rngFrom(seed + '|b') };
    const mech = streams.mech;
    const F = { A: createFighter(opts.a.species), B: createFighter(opts.b.species) };
    const side = {
      A: { brain: opts.a.brain, ai: createAiState(), rng: streams.a },
      B: { brain: opts.b.brain, ai: createAiState(), rng: streams.b }
    };
    const other = s => (s === 'A' ? 'B' : 'A');
    const game = {
      seed, rules, fighters: F, round: 0, over: false, winner: null, timeout: false,
      rounds: [], actions: [],
      needsInput: { A: side.A.brain.kind === 'human', B: side.B.brain.kind === 'human' }
    };

    function decideFor(s, humanMove, round) {
      const cfg = side[s], self = F[s], opp = F[other(s)];
      if (cfg.brain.kind !== 'human') return decide(cfg.brain, cfg.ai, self, opp, round, model, cfg.rng);
      const d = { round, bucket: bucketOf(self, opp, round), probs: null, modelPick: null, final: humanMove, src: 'HUMAN' };
      if (cfg.brain.shadow) {
        // Advice only: what this brain would have played in the human's place.
        d.shadow = decide(cfg.brain.shadow, cfg.ai, self, opp, round, model, cfg.rng);
        cfg.ai.hasUsedUlt = humanMove === 3 || self.moves[3].pp === 0;   // track what was really played
        d.probs = d.shadow.probs; d.modelPick = d.shadow.modelPick;
      }
      return d;
    }

    function firstSide() {
      if (F.A.speed === F.B.speed) return rules.tie === 'coin' ? (mech() < 0.5 ? 'A' : 'B') : 'A';
      return F.A.speed > F.B.speed ? 'A' : 'B';
    }

    /**
     * Plays one round. `human` supplies moves for human sides: { A: moveIndex, B: moveIndex }.
     * Returns the round record (also appended to game.rounds).
     */
    function playRound(human) {
      if (game.over) throw new Error('game is over');
      human = human || {};
      // Check human input before anything changes, so a bad call leaves the game untouched.
      for (const s of ['A', 'B']) {
        if (side[s].brain.kind !== 'human') continue;
        const m = human[s];
        if (!(m === 0 || m === 1 || m === 2 || m === 3) || !isMoveUsable(F[s], m)) throw new Error('side ' + s + ' needs a usable move (0-3), got ' + m);
      }
      const t = ++game.round;
      const rec = { t, pre: { A: snapshot(F.A), B: snapshot(F.B) }, dA: null, dB: null, first: null, events: [], passives: [], post: null, winner: null, timeout: false };
      if (rules.commit === 'simultaneous') {
        rec.dA = decideFor('A', human.A, t);
        rec.dB = decideFor('B', human.B, t);
      }
      rec.first = firstSide();
      const order = [rec.first, other(rec.first)];
      for (let k = 0; k < 2; k++) {
        const s = order[k], att = F[s], def = F[other(s)];
        if (att.isDefeated || def.isDefeated) continue;
        let d;
        if (rules.commit === 'simultaneous') d = s === 'A' ? rec.dA : rec.dB;
        else { d = decideFor(s, human[s], t); if (s === 'A') rec.dA = d; else rec.dB = d; }
        const ev = executeMove(att, def, d.final, mech);
        ev.side = s; ev.src = d.src; ev.hpA = F.A.currentHP; ev.hpB = F.B.currentHP;
        rec.events.push(ev);
        game.actions.push({ t, s, m: ev.mi, src: d.src, dmg: ev.dmg, crit: ev.crit ? 1 : 0, hpA: ev.hpA, hpB: ev.hpB });
        if (def.isDefeated) { rec.winner = s; break; }
      }
      if (!rec.winner) {
        const pa = applyPassive(F.A); if (pa) rec.passives.push(Object.assign({ side: 'A' }, pa));
        const pb = applyPassive(F.B); if (pb) rec.passives.push(Object.assign({ side: 'B' }, pb));
        if (t >= rules.maxRounds) {
          const fa = F.A.currentHP / F.A.maxHP, fb = F.B.currentHP / F.B.maxHP;
          rec.timeout = true;
          if (fa > fb) rec.winner = 'A';
          else if (fb > fa) rec.winner = 'B';
          else rec.winner = rules.tie === 'coin' ? (mech() < 0.5 ? 'A' : 'B') : 'B';
        }
      }
      rec.post = { A: snapshot(F.A), B: snapshot(F.B) };
      if (rec.winner) { game.over = true; game.winner = rec.winner; game.timeout = rec.timeout; }
      game.rounds.push(rec);
      return rec;
    }

    game.playRound = playRound;
    /** Runs to the end. Only for games without human sides. */
    game.run = function () { while (!game.over) playRound(); return game; };
    /** The public record of the game: enough to re-check every hit without the brains. */
    game.transcript = function (meta) {
      return {
        v: 1, engine: ENGINE_ID, model: model ? model.id.slice(0, 16) : null, seed,
        rules: { commit: rules.commit, tie: rules.tie, maxRounds: rules.maxRounds },
        a: Object.assign({ species: opts.a.species, brain: brainTag(opts.a.brain) }, meta && meta.a),
        b: Object.assign({ species: opts.b.species, brain: brainTag(opts.b.brain) }, meta && meta.b),
        actions: game.actions.map(x => ({ t: x.t, s: x.s, m: x.m, dmg: x.dmg, crit: x.crit, hpA: x.hpA, hpB: x.hpB })),
        result: game.over ? { winner: game.winner, rounds: game.round, hpA: F.A.currentHP, hpB: F.B.currentHP, timeout: game.timeout } : null
      };
    };
    return game;
  }

  /**
   * Re-plays a transcript's moves with the seeded dice and checks every recorded
   * number. Needs no brains and no model: it proves the result follows from the
   * moves. Returns { ok, problems[], winner, rounds }.
   */
  function replayTranscript(tr) {
    const problems = [];
    const bad = msg => ({ ok: false, problems: [msg], winner: null, rounds: 0 });
    if (!tr || typeof tr !== 'object' || !tr.a || !tr.b || !Array.isArray(tr.actions)) return bad('transcript is malformed');
    if (!SPECIES[tr.a.species] || !SPECIES[tr.b.species]) return bad('unknown creature');
    const rules = Object.assign({}, DEFAULT_RULES, tr.rules || {});
    const mech = rngFrom(String(tr.seed) + '|mech');
    const F = { A: createFighter(tr.a.species), B: createFighter(tr.b.species) };
    const acts = tr.actions;
    let i = 0, t = 0, winner = null, timeout = false;
    while (!winner && t < rules.maxRounds && problems.length <= 6) {
      t++;
      let first;
      if (F.A.speed === F.B.speed) first = rules.tie === 'coin' ? (mech() < 0.5 ? 'A' : 'B') : 'A';
      else first = F.A.speed > F.B.speed ? 'A' : 'B';
      const order = [first, first === 'A' ? 'B' : 'A'];
      for (let k = 0; k < 2; k++) {
        const s = order[k], att = F[s], def = F[s === 'A' ? 'B' : 'A'];
        if (att.isDefeated || def.isDefeated) continue;
        const a = acts[i];
        if (!a || a.t !== t) { problems.push('round ' + t + ': side ' + s + ' has no recorded move'); break; }
        if (a.s !== s) problems.push('round ' + t + ': side ' + a.s + ' acted out of speed order');
        if (!(a.m >= 0 && a.m <= 3) || !isMoveUsable(att, a.m)) { problems.push('round ' + t + ': move ' + a.m + ' was not usable'); i++; break; }
        const ev = executeMove(att, def, a.m, mech);
        if (ev.dmg !== a.dmg || (ev.crit ? 1 : 0) !== a.crit || F.A.currentHP !== a.hpA || F.B.currentHP !== a.hpB) {
          problems.push('round ' + t + ' side ' + s + ': replay gives ' + ev.dmg + ' damage (HP ' + F.A.currentHP + ' / ' + F.B.currentHP + '), record says ' + a.dmg + ' (HP ' + a.hpA + ' / ' + a.hpB + ')');
        }
        i++;
        if (def.isDefeated) { winner = s; break; }
      }
      if (winner) break;
      if (i < acts.length && acts[i].t === t) { problems.push('round ' + t + ': more moves recorded than a round allows'); break; }
      if (i >= acts.length && t < rules.maxRounds) {
        // The record stops here although nobody has fallen and the round limit is not reached.
        if (!problems.length) problems.push('record ends after round ' + t + ' with both creatures standing');
        break;
      }
      applyPassive(F.A); applyPassive(F.B);
      if (t >= rules.maxRounds) {
        const fa = F.A.currentHP / F.A.maxHP, fb = F.B.currentHP / F.B.maxHP;
        timeout = true;
        if (fa > fb) winner = 'A'; else if (fb > fa) winner = 'B';
        else winner = rules.tie === 'coin' ? (mech() < 0.5 ? 'A' : 'B') : 'B';
      }
    }
    if (winner && i < acts.length) problems.push((acts.length - i) + ' recorded moves come after the battle ended');
    const res = tr.result || {};
    if (winner !== res.winner) problems.push('replay winner is ' + winner + ', record says ' + res.winner);
    if (winner && t !== res.rounds) problems.push('replay lasts ' + t + ' rounds, record says ' + res.rounds);
    if (winner && (F.A.currentHP !== res.hpA || F.B.currentHP !== res.hpB)) problems.push('final HP differs from the record');
    return { ok: problems.length === 0, problems, winner, rounds: t, timeout };
  }

  /**
   * Re-runs a whole game with the brains and checks they make the same moves.
   * `brains` = { a, b } as passed to createGame. Human sides cannot be re-decided.
   */
  function verifyDecisions(tr, brains, model) {
    if (brains.a.kind === 'human' || brains.b.kind === 'human') return { ok: false, problems: ['a human side cannot be re-decided'] };
    const g = createGame({ seed: tr.seed, a: { species: tr.a.species, brain: brains.a }, b: { species: tr.b.species, brain: brains.b }, model, rules: tr.rules }).run();
    const mine = g.transcript();
    const problems = [];
    if (mine.a.brain !== tr.a.brain) problems.push('side A brain does not match the record');
    if (mine.b.brain !== tr.b.brain) problems.push('side B brain does not match the record');
    if (JSON.stringify(mine.actions) !== JSON.stringify(tr.actions)) problems.push('the brains choose different moves than the record');
    if (JSON.stringify(mine.result) !== JSON.stringify(tr.result)) problems.push('the result differs from the record');
    return { ok: problems.length === 0, problems };
  }

  const canonical = obj => JSON.stringify(obj);
  const transcriptHash = tr => sha256Hex(canonical(tr));

  return {
    ENGINE_ID,
    // model
    createModel,
    // rules and data
    TYPE, TYPE_NAME, SPECIES, SPECIES_NAMES, GRADES, DEFAULT_RULES,
    createFighter, getTypeEffectiveness, isMoveUsable, usableMoves, snapshot,
    // habit layer
    BUCKETS, ACTIONS, EPS_BIRTH, EPS_FLOOR, COVERAGE_TARGET, DAILY_CAP, OVERRIDE_CAP, MIN_BUCKET, MIN_COVER, BUCKET_MEMORY,
    OWN_LABELS, OPP_LABELS, PHASE_LABELS, REL_LABELS,
    newProfile, bucketOf, decodeBucket, bucketTotal, recordTurn, epsilonOf, habitInfo, typeRelation,
    encodeProfile, decodeProfile, profileCode, profileFromCode, profileHash,
    // brains and games
    gradeOf, brainTag, createGame, replayTranscript, verifyDecisions, canonical, transcriptHash,
    // primitives
    rngFrom, sha256, sha256Hex, toHex, utf8, b64urlEncode, b64urlDecode, dexp, sigmoid, dtanh, clamp,
    // exposed for tests
    _internals: { calculateDamage, executeMove, applyPassive, applyMoveEffect, buildObservation, planMove, applyRules, simulateDamage, createAiState, decide, getMoveIdx }
  };
});
