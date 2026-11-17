/*!
 * Capmon Arena effects: soft glowing particles on a canvas over the stage, beams,
 * screen shake, flashes, slam text, haptics and synthesized sound. Presentation only.
 * Nothing here feeds the engine, so Math.random is fine in this file.
 */
(function () {
  'use strict';
  const COL = {
    Fire: ['#ffe9a0', '#ffa63d', '#ff4a1c'], Water: ['#d9f3ff', '#5cbcff', '#2b6bff'], Grass: ['#e6ffa0', '#6fe389', '#18a04e'],
    Normal: ['#ffffff', '#ffe9a8', '#d6deea'], Mind: ['#f1e3ff', '#b48cff', '#7a4dff'], Gold: ['#ffffff', '#ffe27a', '#ffb300']
  };
  const TAU = 6.2832;
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const calm = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let stage = null, cv = null, g = null, W = 0, H = 0, dpr = 1, parts = [], emitters = [], raf = 0, last = 0, ambientOn = null;
  const sprites = {};
  /** A soft dot: white-hot centre, the colour, then nothing. Drawn once per colour, reused. */
  function soft(color) {
    let c = sprites[color];
    if (!c) {
      c = sprites[color] = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32), n = parseInt(color.slice(1), 16);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, color); gr.addColorStop(1, 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    }
    return c;
  }
  function measure() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
  }
  function attach(stageEl) {
    stage = stageEl; cv = stageEl ? stageEl.querySelector('canvas.fx') : null; parts = []; emitters = []; ambientOn = null;
    if (!cv) { g = null; return; }
    g = cv.getContext('2d'); measure();
  }
  function kick() { if (!raf && g) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function spawn(p) { if (!g || parts.length > 520) return p; parts.push(p); kick(); return p; }
  function tick(now) {
    // `raf` stays set while this runs, so particles spawned from inside a frame cannot start a second loop.
    if (!cv || !cv.isConnected) { raf = 0; parts = []; emitters = []; return; }
    if (Math.abs(cv.clientWidth - W) > 1) measure();               // the stage was resized
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const e of emitters) e(dt);
    emitters = emitters.filter(e => !e.done);
    for (const p of parts) {
      p.life -= dt; p.vy += (p.g || 0) * dt;
      if (p.drag) { const d = Math.pow(p.drag, dt * 60); p.vx *= d; p.vy *= d; }
      p.x += p.vx * dt; p.y += p.vy * dt; if (p.vr) p.rot += p.vr * dt;
    }
    parts = parts.filter(p => p.life > 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    for (const p of parts) draw(p);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    raf = parts.length || emitters.length ? requestAnimationFrame(tick) : 0;
  }
  function draw(p) {
    const t = Math.max(0, p.life / p.max), a = Math.min(1, t * (p.fade || 1.8)) * (p.alpha || 1);
    g.globalAlpha = a;
    g.globalCompositeOperation = p.add === false ? 'source-over' : 'lighter';
    if (p.kind === 'ring') {
      g.lineWidth = Math.max(0.6, p.w * t); g.strokeStyle = p.color; g.beginPath();
      const r = p.r0 + (p.r1 - p.r0) * (1 - t * t);
      if (p.arc) g.arc(p.x, p.y, r, p.arc[0], p.arc[1]); else g.arc(p.x, p.y, r, 0, TAU);
      g.stroke(); return;
    }
    if (p.kind === 'beam') {
      const jy = R(-1.5, 1.5), w = p.w * (0.75 + 0.25 * Math.sin(p.life * 90));
      const line = (lw, col, al) => { g.globalAlpha = a * al; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(p.x, p.y + jy); g.lineTo(p.x2, p.y2 + jy); g.stroke(); };
      g.lineCap = 'round'; line(w * 2.6, p.color, 0.28); line(w * 1.3, p.color, 0.75); line(w * 0.5, '#ffffff', 1); return;
    }
    const s = p.size * (p.grow ? 1 + (1 - t) * p.grow : p.keep ? 1 : 0.35 + 0.65 * t);
    if (p.kind === 'spark') { g.strokeStyle = p.color; g.lineWidth = Math.max(1.2, s * 0.6); g.lineCap = 'round'; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); g.stroke(); return; }
    if (p.kind === 'leaf' || p.kind === 'rect') {
      g.fillStyle = p.color; g.save(); g.translate(p.x, p.y); g.rotate(p.rot || 0);
      if (p.kind === 'leaf') { g.beginPath(); g.ellipse(0, 0, s, s * 0.42, 0, 0, TAU); g.fill(); } else g.fillRect(-s, -s * 0.5, s * 2, s);
      g.restore(); return;
    }
    if (p.color.charAt(0) === '#') { const r = s * 2.3; g.drawImage(soft(p.color), p.x - r, p.y - r, r * 2, r * 2); return; }
    g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, s, 0, TAU); g.fill();
  }

  /** Where a fighter stands, in stage pixels. side is 'A' (left) or 'B' (right). */
  function at(side) {
    if (!stage) return { x: 0, y: 0, w: 0, top: 0, foot: 0 };
    const f = stage.querySelector(side === 'A' ? '.fighter.left' : '.fighter.right'), s = stage.getBoundingClientRect();
    if (!f) return { x: s.width / 2, y: s.height / 2, w: 0, top: 0, foot: s.height };
    const r = f.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height * 0.52, w: r.width, top: r.top - s.top, foot: r.bottom - s.top };
  }
  const unit = () => Math.max(0.6, W / 640);                         // effects scale with the stage
  function burst(x, y, kind, n, power) {
    const c = COL[kind] || COL.Normal, u = unit(); power *= u;
    for (let i = 0; i < n; i++) { const a = R(0, TAU), v = R(0.25, 1) * power; spawn({ kind: i % 3 ? 'spark' : 'dot', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.12, g: power * 1.2, drag: 0.92, life: R(0.25, 0.6), max: 0.6, size: R(2, 5) * u, color: pick(c) }); }
    spawn({ kind: 'dot', x: x, y: y, vx: 0, vy: 0, life: 0.16, max: 0.16, size: power * 0.07, color: c[1], keep: true });
  }
  function ring(x, y, kind, r1, life, w, arc) { spawn({ kind: 'ring', x: x, y: y, vx: 0, vy: 0, r0: 6, r1: r1 * unit(), w: (w || 6) * unit(), life: life, max: life, color: (COL[kind] || COL.Normal)[1], arc: arc }); }
  function projectile(a, b, kind, dur) {
    const c = COL[kind] || COL.Normal, u = unit(), lift = Math.min(46, Math.abs(b.x - a.x) * 0.1);
    let t = 0;
    const e = dt => {
      t += dt / dur; const k = Math.min(1, t), x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - Math.sin(k * 3.1416) * lift;
      for (let i = 0; i < 3; i++) {
        if (kind === 'Grass') spawn({ kind: 'leaf', add: false, x: x + R(-7, 7) * u, y: y + R(-7, 7) * u, vx: R(-50, 50), vy: R(-50, 50), rot: R(0, TAU), vr: R(-12, 12), life: R(0.2, 0.42), max: 0.42, size: R(4, 8) * u, color: pick(c) });
        else spawn({ kind: 'dot', x: x + R(-5, 5) * u, y: y + R(-5, 5) * u, vx: R(-34, 34), vy: R(-34, 34) + (kind === 'Water' ? 46 : -34), life: R(0.15, 0.4), max: 0.4, size: R(2.5, 6) * u, color: pick(c) });
      }
      spawn({ kind: 'dot', x: x, y: y, vx: 0, vy: 0, life: 0.06, max: 0.06, size: 9 * u, color: c[1], keep: true });
      if (k >= 1) e.done = true;
    };
    emitters.push(e); kick();
  }
  function beam(a, b, kind, dur) {
    const c = COL[kind] || COL.Normal, u = unit(), core = spawn({ kind: 'beam', x: a.x, y: a.y, x2: a.x, y2: a.y, vx: 0, vy: 0, w: 13 * u, color: c[1], life: dur, max: dur, fade: 6 });
    let t = 0;
    const e = dt => {
      t += dt; const reach = Math.min(1, t / (dur * 0.28));
      core.x2 = a.x + (b.x - a.x) * reach; core.y2 = a.y + (b.y - a.y) * reach;
      for (let i = 0; i < 7; i++) { const k = Math.random() * reach; spawn(kind === 'Grass' && i % 2 ? { kind: 'leaf', add: false, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + R(-12, 12) * u, vx: (b.x - a.x) * R(0.4, 1), vy: R(-90, 90), rot: R(0, TAU), vr: R(-14, 14), life: R(0.15, 0.35), max: 0.35, size: R(4, 8) * u, color: pick(c) } : { kind: 'dot', x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + R(-9, 9) * u, vx: (b.x - a.x) * R(0.2, 0.8), vy: R(-110, 110), life: R(0.12, 0.3), max: 0.3, size: R(2, 5) * u, color: pick(c) }); }
      if (t >= dur) e.done = true;
    };
    emitters.push(e); kick();
  }
  function charge(a, kind, dur) {
    const c = COL[kind] || COL.Normal, u = unit(); let t = 0;
    const e = dt => { t += dt; for (let i = 0; i < 3; i++) { const ang = R(0, TAU), r = R(40, 95) * u; spawn({ kind: 'dot', x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r, vx: -Math.cos(ang) * r / 0.26, vy: -Math.sin(ang) * r / 0.26, life: 0.26, max: 0.26, size: R(2, 4.5) * u, color: pick(c), fade: 9 }); } spawn({ kind: 'dot', x: a.x, y: a.y, vx: 0, vy: 0, life: 0.05, max: 0.05, size: (6 + t * 26) * u, color: c[1], keep: true }); if (t >= dur) e.done = true; };
    emitters.push(e); kick();
  }
  function roar(a, b) {
    const dir = b.x > a.x ? 0 : Math.PI, d = Math.abs(b.x - a.x);
    for (let i = 0; i < 3; i++) setTimeout(() => spawn({ kind: 'ring', x: a.x, y: a.y, vx: 0, vy: 0, r0: 12, r1: d, w: 10 * unit(), life: 0.44, max: 0.44, color: COL.Mind[1], arc: [dir - 0.5, dir + 0.5] }), i * 85);
  }
  function sparkle(a, kind, n, down) { const c = COL[kind] || COL.Normal, u = unit(); for (let i = 0; i < n; i++) spawn({ kind: 'dot', x: a.x + R(-28, 28) * u, y: a.y + R(-12, 30) * u, vx: R(-10, 10), vy: (down ? R(40, 95) : R(-95, -40)) * u, life: R(0.5, 0.9), max: 0.9, size: R(1.6, 3.6) * u, color: pick(c) }); }
  function dust(x, y) { const u = unit(); for (let i = 0; i < 16; i++) spawn({ kind: 'dot', add: false, x: x + R(-22, 22) * u, y: y, vx: R(-110, 110) * u, vy: R(-70, -10) * u, g: 70, drag: 0.92, life: R(0.4, 0.85), max: 0.85, size: R(3, 7) * u, color: 'rgba(238,230,210,0.55)', grow: 1.3 }); }
  function confetti() {
    const cols = ['#3df5e4', '#ffd23d', '#ff5fa8', '#7be38f', '#6cc4ff', '#ffffff'], u = unit();
    for (let i = 0; i < 120; i++) spawn({ kind: 'rect', add: false, x: R(0, W), y: R(-H * 0.6, 0), vx: R(-50, 50), vy: R(70, 220) * u, g: 130 * u, drag: 0.99, rot: R(0, TAU), vr: R(-9, 9), life: R(1.5, 2.8), max: 2.8, size: R(3, 6) * u, color: pick(cols), keep: true, fade: 5 });
  }
  /** Slow drifting motes around each fighter while a battle is on screen: embers, bubbles, leaves. */
  function ambient(kindA, kindB) {
    if (calm() || !g) return;
    const token = ambientOn = {}; let acc = 0;
    const e = dt => {
      if (ambientOn !== token) { e.done = true; return; }
      acc += dt; if (acc < 0.16) return; acc = 0;
      [['A', kindA], ['B', kindB]].forEach(x => {
        const q = at(x[0]), c = COL[x[1]] || COL.Normal, u = unit();
        if (!q.w) return;
        if (x[1] === 'Grass') spawn({ kind: 'leaf', add: false, alpha: 0.85, x: q.x + R(-0.7, 0.7) * q.w, y: q.top + R(0, q.w * 0.5), vx: R(-22, 22), vy: R(14, 34), rot: R(0, TAU), vr: R(-3, 3), life: R(1, 1.8), max: 1.8, size: R(2.5, 4.5) * u, color: pick(c) });
        else spawn({ kind: 'dot', alpha: 0.8, x: q.x + R(-0.55, 0.55) * q.w, y: q.foot - R(0, q.w * 0.5), vx: R(-10, 10), vy: R(-46, -20), life: R(0.8, 1.5), max: 1.5, size: R(1.2, 2.6) * u, color: pick(c) });
      });
    };
    emitters.push(e); kick();
  }
  function buzz(ms) { try { if (soundOn && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ } }
  function shake(level) { if (!stage || calm()) return; stage.classList.remove('shake-s', 'shake-m', 'shake-l'); void stage.offsetWidth; stage.classList.add('shake-' + level); buzz(level === 'l' ? 60 : level === 'm' ? 25 : 10); }
  function flash(kind) { const f = stage && stage.querySelector('.flash'); if (!f || calm()) return; f.className = 'flash'; void f.offsetWidth; f.className = 'flash ' + kind; }
  function slam(text, cls) { if (!stage) return; const el = document.createElement('div'); el.className = 'slam ' + (cls || ''); el.textContent = text; stage.appendChild(el); setTimeout(() => el.remove(), 1150); }
  /** Camera punch toward one side of the stage, for knock-outs. */
  function zoom(side, ms) { if (!stage || calm()) return; const st = stage; st.style.transformOrigin = (side === 'A' ? '24%' : '76%') + ' 58%'; st.classList.add('zoom'); setTimeout(() => st.classList.remove('zoom'), ms); }

  // ---------- sound ----------
  let actx = null, master = null, soundOn = true, nbuf = null;
  function audio() {
    if (!soundOn) return null;
    try {
      if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); master = actx.createGain(); master.gain.value = 0.42; master.connect(actx.destination); }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(f0, f1, dur, type, vol, delay) {
    const c = audio(); if (!c) return;
    const t = c.currentTime + (delay || 0), o = c.createOscillator(), gn = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, f0, f1, delay, q) {
    const c = audio(); if (!c) return;
    if (!nbuf) { nbuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = c.currentTime + (delay || 0), s = c.createBufferSource(), fl = c.createBiquadFilter(), gn = c.createGain();
    s.buffer = nbuf; fl.type = 'bandpass'; fl.Q.value = q || 0.8; fl.frequency.setValueAtTime(f0, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(master); s.start(t); s.stop(t + dur + 0.03);
  }
  const seq = (notes, type, vol, step, lastLen) => notes.forEach((f, i) => tone(f, f, i === notes.length - 1 ? lastLen : step * 1.1, type, vol, i * step));
  const SFX = {
    on: v => { soundOn = !!v; if (actx) { try { if (soundOn) actx.resume(); else actx.suspend(); } catch (e) { /* ignore */ } } },
    isOn: () => soundOn,
    click: () => tone(700, 1050, 0.05, 'triangle', 0.09),
    whoosh: () => noise(0.2, 0.28, 500, 2800),
    hit: () => { noise(0.14, 0.55, 900, 170); tone(165, 58, 0.17, 'sine', 0.55); },
    crit: () => { noise(0.2, 0.65, 2400, 280); tone(220, 48, 0.26, 'sine', 0.65); tone(1320, 1760, 0.18, 'square', 0.1, 0.02); },
    fire: () => noise(0.36, 0.36, 300, 1900, 0, 0.5),
    water: () => { noise(0.3, 0.32, 1500, 480, 0, 2); tone(520, 230, 0.26, 'sine', 0.14); },
    leaf: () => { noise(0.18, 0.26, 3000, 5400, 0, 3); noise(0.2, 0.2, 3800, 2300, 0.07, 3); },
    roar: () => { tone(190, 66, 0.46, 'sawtooth', 0.2); noise(0.42, 0.22, 260, 110, 0, 0.6); },
    down: () => tone(540, 180, 0.28, 'triangle', 0.15),
    charge: () => tone(130, 900, 0.42, 'sawtooth', 0.12),
    boom: () => { noise(0.65, 0.85, 620, 55, 0, 0.4); tone(112, 30, 0.62, 'sine', 0.85); },
    ko: () => { tone(440, 52, 0.75, 'sawtooth', 0.22); noise(0.5, 0.4, 520, 75, 0.05); },
    buff: () => { tone(660, 880, 0.1, 'sine', 0.09); tone(990, 1320, 0.12, 'sine', 0.07, 0.08); },
    learn: () => seq([523, 659, 784, 1047], 'triangle', 0.13, 0.07, 0.22),
    vs: () => { tone(92, 44, 0.5, 'sawtooth', 0.26); noise(0.32, 0.3, 220, 2200, 0.02); },
    fight: () => { tone(330, 330, 0.09, 'square', 0.14); tone(494, 494, 0.22, 'square', 0.14, 0.1); },
    win: () => seq([523, 659, 784, 1047, 1319], 'square', 0.11, 0.11, 0.5),
    lose: () => seq([392, 330, 262, 196], 'triangle', 0.15, 0.16, 0.5)
  };

  window.CapmonFX = { FX: { attach, at, burst, ring, projectile, beam, charge, roar, sparkle, dust, confetti, ambient, shake, flash, slam, zoom }, SFX };
})();
