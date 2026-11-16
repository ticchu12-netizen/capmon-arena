/*!
 * Capmon Arena, Season 0: the page. Views, the battle stage, teach mode, the daily
 * card, challenge and match codes. All game logic is in engine.js and game.js.
 */
(function () {
  'use strict';
  const E = window.CapmonEngine, G = window.CapmonGame, S = window.CapmonStore;
  const CFG = Object.assign({ links: 'hash', base: location.origin + location.pathname, brainUrl: 'assets/brain.bin' }, window.ARENA_CONFIG || {});
  const VIEWS = ['arena', 'teach', 'brain', 'ladder', 'check'];
  const TYPE_NAME = E.TYPE_NAME;
  const LEVELS = [['pebble', 'Easy'], ['marshal', 'Medium'], ['apex', 'Hard']];
  const SRC_LABEL = { MODEL: 'model', HABIT: 'habit', RANDOM: 'random', MCTS: 'planner', RULE: 'rule', HUMAN: 'you' };
  const RULE_TEXT = {
    BIG_MOVE_TO_FINISH: 'the big move can finish this', BIG_MOVE_WHEN_LOW: 'under 40% HP, use the big move now',
    BIG_MOVE_SAVED_FOR_FINISH: 'opponent is weak and softened, use the big move', INTIMIDATE_WHEN_OUTMATCHED: 'bad type matchup, lower their defense first',
    TYPED_MOVE_FOR_KO: 'the element move can finish this', TYPED_MOVE_WITH_ADVANTAGE: 'good type matchup, use the element move'
  };

  let model = null, state = S.load(), runId = 0;
  const ui = { view: 'arena', overlay: null, watch: null, teach: { phase: 'setup' }, brainRel: 1, brainCell: -1, check: null, busy: null, ob: null };

  // ---------- small helpers ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pct = (x, d) => { const v = Math.round(x * 100 * (d ? 10 : 1)) / (d ? 10 : 1); return v + '%'; };
  const save = () => S.save(state);
  const crea = (species, cls) => '<div class="crea ' + (cls || '') + '" data-species="' + esc(species) + '" role="img" aria-label="' + esc(species) + '"></div>';
  const myRef = () => G.studentRef(state.name, state.starter, state.brain);
  const moveType = (species, i) => (i === 1 || i === 3 ? TYPE_NAME[E.SPECIES[species].type] : 'Normal');
  let toastTimer = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }
  function copyText(text, okMsg) {
    const fallback = () => openOverlay('<div class="stack"><h2>Copy this</h2><textarea class="input" id="copy-box" readonly rows="5">' + esc(text) + '</textarea><button class="btn" data-act="close">Done</button></div>', () => { const b = $('#copy-box'); if (b) { b.focus(); b.select(); } });
    try { navigator.clipboard.writeText(text).then(() => toast(okMsg || 'Copied'), fallback); } catch (e) { fallback(); }
  }
  const linkFor = (kind, code) => (CFG.links === 'hash' ? CFG.base + '#' + kind + '=' + code : code);

  // ---------- shell ----------
  function openOverlay(html, after) { ui.overlay = html; const o = $('#overlay'); o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>'; o.hidden = false; if (after) after(); }
  function closeOverlay() { ui.overlay = null; const o = $('#overlay'); o.hidden = true; o.innerHTML = ''; }
  function go(view) {
    runId++;
    ui.view = view;
    const t = ui.teach, live = view === 'teach' && t.game && t.phase !== 'setup';
    if (live) { t.id = runId; t.busy = false; teachSettle(); }
    try { if (VIEWS.indexOf(view) >= 0 && location.hash !== '#' + view) history.replaceState(null, '', '#' + view); } catch (e) { /* preview frames may refuse */ }
    render();
    if (live) teachRestore();
    window.scrollTo(0, 0);
  }
  function render() {
    const tab = ui.view === 'watch' ? (ui.watch && ui.watch.from) || 'arena' : ui.view;
    document.querySelectorAll('#tabbar button').forEach(b => { if (b.dataset.view === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const v = $('#view');
    if (!model) { v.innerHTML = ui.loadError ? '<div class="loading"><h2>The brain did not load</h2><p class="soft">' + esc(ui.loadError) + '</p><button class="btn primary" data-act="reload">Try again</button></div>' : '<div class="loading"><div class="spin"></div><div>Loading the brain<br><span class="dim small" id="load-note">4 MB, one time</span></div></div>'; return; }
    v.innerHTML = ({ arena: viewArena, teach: viewTeach, brain: viewBrain, ladder: viewLadder, check: viewCheck, watch: viewWatch }[ui.view] || viewArena)();
  }

  // ---------- onboarding ----------
  function showOnboarding(after) {
    ui.ob = ui.ob || { starter: state.starter, after: null };
    if (after) ui.ob.after = after;
    const blurb = { Rageblaze: 'Fire. Fast, hits hard, thin armor.', Tsunami: 'Water. Slow, tough, speeds up.', Healspike: 'Grass. Heals a little each round.' };
    openOverlay('<form class="stack" id="ob-form"><div><div class="eyebrow accent">Capmon Arena, Season 0</div><h1>Teach a brain. Watch it fight.</h1></div>' +
      '<p class="soft">Your brain starts with the instincts of the real Capmon World battle AI. You teach it your habits by playing. Then it plays ranked matches without you.</p>' +
      '<div class="field"><label for="ob-name">Name your brain</label><input class="input" id="ob-name" maxlength="16" autocomplete="off" placeholder="16 characters max" value="' + esc(ui.ob.name || '') + '"></div>' +
      '<div class="field"><label>Pick a starter</label><div class="starters">' + G.SPECIES.map(s => '<button type="button" class="starter" data-act="ob-starter" data-s="' + s + '" aria-pressed="' + (ui.ob.starter === s) + '">' + crea(s) + '<b>' + s + '</b><span>' + blurb[s] + '</span></button>').join('') + '</div></div>' +
      '<p class="note" id="ob-err" hidden></p><button class="btn primary wide" type="submit">Start</button>' +
      '<p class="dim small">Free. No account, no wallet. Everything is saved in this browser only.</p></form>');
  }
  function finishOnboarding() {
    const raw = ($('#ob-name').value || '').trim();
    if (!raw) { const e = $('#ob-err'); e.textContent = 'Type a name for your brain.'; e.hidden = false; $('#ob-name').focus(); return; }
    state.name = G.cleanName(raw); state.starter = ui.ob.starter; state.onboarded = true; save();
    const after = ui.ob.after; ui.ob = null; closeOverlay();
    if (after) after(); else { ui.teach = { phase: 'setup' }; go('teach'); toast('Step one: teach ' + state.name + ' a few battles'); }
  }

  // ---------- arena ----------
  function todayCard() {
    const day = S.today();
    if (!state.days[day]) { state.days[day] = { opp: G.dailyOpponents(state.id, day, state.rating), done: [null, null, null] }; save(); }
    return { day: day, card: state.days[day] };
  }
  function brainCard() {
    const p = S.profileOf(state), s = G.brainSummary(p);
    return '<section class="panel stack"><div class="row between"><div class="who">' + crea(state.starter, 'big') + '<div class="grow"><div class="name ellip">' + esc(state.name) + '</div><div class="row" style="gap:6px"><span class="chip gold">' + G.tierOf(state.rating) + '</span><span class="rating">' + state.rating + '</span></div></div></div>' +
      '<button class="btn small ghost" data-act="nav" data-view="brain">Open brain</button></div>' +
      '<div class="stats"><div class="stat"><b>' + s.habits + '</b><span>habits formed</span></div><div class="stat"><b>' + s.covered + '<small class="dim" style="font-size:14px"> / ' + s.target + '</small></b><span>situations learned</span></div><div class="stat"><b>' + pct(s.randomness) + '</b><span>random moves</span></div><div class="stat"><b>' + state.ranked.won + '-' + (state.ranked.played - state.ranked.won) + '</b><span>ranked record</span></div></div></section>';
  }
  function matchRow(rec, label, attrs) {
    const res = rec.seen ? '<span class="chip ' + (rec.won ? 'win' : 'loss') + '">' + (rec.won ? 'Won ' : 'Lost ') + esc(rec.score) + '</span>' + (rec.k === 'r' ? '<span class="mono ' + (rec.r1 >= rec.r0 ? 't-Healspike' : 'dim') + '">' + (rec.r1 >= rec.r0 ? '+' : '') + (rec.r1 - rec.r0) + '</span>' : '') : '<span class="chip accent">Result hidden</span>';
    return '<div class="item"><div class="meta"><div class="t"><span class="ellip">vs ' + esc(rec.opp) + '</span>' + res + '</div><div class="s">' + esc(label) + '</div></div><div class="act"><button class="btn small' + (rec.seen ? '' : ' primary') + '" data-act="watch-rec" ' + attrs + '>' + (rec.seen ? 'Rewatch' : 'Watch') + '</button></div></div>';
  }
  function viewArena() {
    if (!state.onboarded) return '<section class="panel stack"><div class="eyebrow accent">Capmon Arena, Season 0</div><h1>Teach a brain. Watch it fight.</h1><p class="soft">A free browser game on the real Capmon World battle engine. No account, no wallet.</p><div><button class="btn primary" data-act="onboard">Create your brain</button></div></section>' + ladderPanel(8);
    const tc = todayCard(), card = tc.card, played = card.done.filter(Boolean).length;
    let rows = '';
    card.opp.forEach((id, i) => {
      const h = G.ROSTER_BY_ID[id], rec = card.done[i];
      if (rec) rows += matchRow(rec, 'Match ' + (i + 1) + ' of 3. ' + h.name + ' is rated ' + h.rating + '.', 'data-day="' + tc.day + '" data-slot="' + i + '"');
      else rows += '<div class="item">' + crea(h.starter) + '<div class="meta"><div class="t"><span class="ellip">' + esc(h.name) + '</span><span class="rating dim">' + h.rating + '</span></div><div class="s">' + esc(h.bio) + '</div></div></div>';
    });
    const untaught = state.teach.battles === 0;
    const unseen = card.done.some(r => r && !r.seen);
    let cta;
    if (ui.busy) cta = '<button class="btn primary wide" disabled>' + esc(ui.busy) + '</button>';
    else if (played < 3) cta = (untaught ? '<p class="note accent">Your brain has not been taught yet. It will play on instinct and random moves. <button class="btn small" data-act="nav" data-view="teach" style="margin-left:6px">Teach first</button></p>' : '') + '<button class="btn primary wide" data-act="play-card">Play today\'s 3 ranked matches</button><p class="dim small">Your brain plays alone, as it is right now. First to two games wins a match. Both sides use the same creature in each game, so the brain decides it.</p>';
    else cta = '<p class="note">Today\'s matches are done. New opponents tomorrow. Until then, teach your brain or challenge a friend.</p>' + (unseen ? '<button class="btn small ghost" data-act="reveal-card">Show all results</button>' : '');
    const recent = recentRecords().slice(0, 6);
    const share = CFG.links === 'hash' ? 'They open the link and their brain plays yours in their browser.' : 'They paste the code under Open a code and their brain plays yours.';
    return '<div class="cols two"><div class="stack">' + brainCard() +
      '<section class="panel stack"><div class="row between"><span class="eyebrow accent">Today, ' + esc(tc.day) + '</span><span class="dim small">' + played + ' of 3 played</span></div><div class="list">' + rows + '</div>' + cta + '</section></div>' +
      '<div class="stack"><section class="panel stack"><span class="eyebrow">Challenge a friend</span><p class="soft">Send your brain. ' + share + '</p><div class="row"><button class="btn" data-act="copy-challenge">Copy ' + (CFG.links === 'hash' ? 'challenge link' : 'my brain code') + '</button><button class="btn ghost" data-act="open-code">Open a code</button></div></section>' +
      (recent.length ? '<section class="panel"><span class="eyebrow">Recent matches</span><div class="list">' + recent.map(r => matchRow(r.rec, (r.rec.k === 'c' ? 'Challenge' : 'Ranked') + ', ' + r.rec.day, r.attrs)).join('') + '</div></section>' : '') + '</div></div>';
  }
  function recentRecords() {
    const out = [];
    Object.keys(state.days).forEach(day => state.days[day].done.forEach((rec, i) => { if (rec) out.push({ rec: rec, attrs: 'data-day="' + day + '" data-slot="' + i + '"' }); }));
    state.log.forEach((rec, i) => out.push({ rec: rec, attrs: 'data-log="' + i + '"' }));
    out.sort((a, b) => b.rec.at - a.rec.at);
    return out;
  }
  async function playCard() {
    const tc = todayCard(), card = tc.card;
    let first = -1;
    for (let i = 0; i < 3; i++) {
      if (card.done[i]) continue;
      ui.busy = 'Playing match ' + (i + 1) + ' of 3'; render(); await sleep(30);
      const house = G.ROSTER_BY_ID[card.opp[i]];
      const m = { seed: G.rankedSeed(state.id, tc.day, i), a: myRef(), b: G.houseRef(house.id) };
      const res = G.playMatch(m, model), won = res.winner === 'A';
      const r1 = Math.max(0, state.rating + G.ratingDelta(state.rating, house.rating, won));
      card.done[i] = { k: 'r', day: tc.day, code: G.encodeMatchCode({ seed: m.seed, a: m.a, b: m.b, winners: res.winners }), me: 'A', won: won, score: res.score.join('-'), opp: house.name, oppId: house.id, r0: state.rating, r1: r1, seen: false, at: Date.now() };
      state.rating = r1; state.peak = Math.max(state.peak, r1); state.ranked.played++; if (won) state.ranked.won++;
      save();
      if (first < 0) first = i;
    }
    ui.busy = null;
    if (first >= 0) startWatch(card.done[first], { day: tc.day, slot: first }); else render();
  }

  // ---------- ladder ----------
  function ladderPanel(limit) {
    const rows = G.standings(state.onboarded ? { name: state.name, starter: state.starter, rating: state.rating } : null);
    return '<section class="panel"><span class="eyebrow">Season 0 ladder</span><div class="list">' + rows.slice(0, limit || rows.length).map(r =>
      '<div class="item' + (r.house ? '' : ' me') + '"><span class="rank">' + r.rank + '</span>' + crea(r.starter) + '<div class="meta"><div class="t"><span class="ellip">' + esc(r.name) + '</span><span class="chip' + (r.house ? '' : ' accent') + '">' + (r.house ? r.tier : 'You, ' + r.tier) + '</span></div>' + (r.house ? '<div class="s">' + esc(r.bio) + '</div>' : '<div class="s">Peak ' + state.peak + '. ' + state.ranked.played + ' ranked matches.</div>') + '</div><span class="rating">' + r.rating + '</span></div>').join('') + '</div></section>';
  }
  function viewLadder() {
    return '<div class="stack"><div><h1>Ladder</h1><p class="soft">Ten house brains, rated from 5,500 matches against each other. Your brain starts at 1000, the rating of an untaught brain, and moves with every ranked match.</p></div>' + ladderPanel() +
      '<p class="dim small">House brains never change during the season, so a rating means the same thing for every player.</p></div>';
  }

  // ---------- the stage ----------
  function stageHTML() {
    return '<div class="stage" id="stage"><div class="stage-top"><div class="hud left"><div class="n ellip" id="nA"></div><div class="hp" id="hpA"><i></i></div><div class="v" id="vA"></div></div><div class="hud right"><div class="n ellip" id="nB"></div><div class="hp" id="hpB"><i></i></div><div class="v" id="vB"></div></div></div>' +
      '<div class="roundchip" id="roundchip"></div><div class="fighter left" id="fA"></div><div class="fighter right" id="fB"></div></div><div class="callout" id="callout" aria-live="polite"></div>';
  }
  function stageInit(names, species) {
    ['A', 'B'].forEach((s, i) => { $('#n' + s).textContent = names[i]; const f = $('#f' + s); f.className = 'fighter ' + (i ? 'right' : 'left'); f.innerHTML = crea(species); });
    $('#callout').innerHTML = ''; const b = $('#stage .banner'); if (b) b.remove();
  }
  function stageSnap(snap, round) {
    ['A', 'B'].forEach(s => {
      const x = snap[s], f = x.hp / x.maxHP, bar = $('#hp' + s);
      if (!bar) return;
      bar.className = 'hp' + (f <= 0.25 ? ' low' : f <= 0.5 ? ' mid' : ''); bar.firstChild.style.width = Math.max(0, f * 100) + '%';
      $('#v' + s).innerHTML = '<span>' + x.hp + '/' + x.maxHP + '</span><span class="' + (x.def < x.baseDef ? 'down' : x.def > x.baseDef ? 'up' : '') + '">DEF ' + x.def + '</span><span class="' + (x.spd > x.baseSpd ? 'up' : '') + '">SPD ' + x.spd + '</span>';
      $('#f' + s).classList.toggle('down', x.hp <= 0);
    });
    if (round != null) $('#roundchip').textContent = 'Round ' + round;
  }
  function pop(side, text, cls) {
    const st = $('#stage'); if (!st) return;
    const el = document.createElement('div'); el.className = 'pop ' + (side === 'A' ? 'left' : 'right') + ' ' + cls; el.textContent = text; st.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  /** Plays one round record on the stage. ctx = { id, names, speed(), skip } */
  async function animRound(rec, ctx) {
    const ok = () => ctx.id === runId && $('#stage');
    const wait = async ms => { if (!ctx.skip()) await sleep(ms / ctx.speed()); return ok(); };
    const vm = { A: Object.assign({}, rec.pre.A), B: Object.assign({}, rec.pre.B) };
    stageSnap(vm, rec.t);
    for (const ev of rec.events) {
      const att = ev.side, def = att === 'A' ? 'B' : 'A', fa = $('#f' + att), fd = $('#f' + def);
      const src = ev.src === 'HUMAN' ? '' : ' <span class="chip src-' + ev.src + '">' + SRC_LABEL[ev.src] + '</span>';
      let effect = '';
      if (ev.raw > 0 || ev.dmg > 0) effect = (ev.crit ? 'Critical hit, ' : '') + ev.dmg + ' damage';
      else if (ev.name === 'Intimidate') effect = ev.maxed ? 'no effect, defense is already at the floor' : 'defense down ' + ev.defDrop;
      $('#callout').innerHTML = '<span><b>' + esc(ctx.names[att === 'A' ? 0 : 1]) + '</b> used <b class="mc-' + TYPE_NAME[ev.moveType] + '" style="color:var(--mc)">' + esc(ev.name) + '</b></span>' + src + (effect ? '<span class="soft">' + effect + '</span>' : '');
      fa.classList.add(ev.raw > 0 ? 'lunge' : 'cast');
      if (!await wait(260)) return false;
      if (ev.raw > 0) { fd.classList.add('hit'); pop(def, '-' + ev.dmg, ev.crit ? 'crit' : 'dmg'); }
      else if (ev.name === 'Intimidate') pop(def, ev.maxed ? 'no effect' : 'DEF -' + ev.defDrop, 'debuff');
      vm[def].hp = def === 'A' ? ev.hpA : ev.hpB; vm[def].def -= ev.defDrop; vm[def].debuff += ev.debuffAdded;
      stageSnap(vm, rec.t);
      if (!await wait(360)) return false;
      fa.classList.remove('lunge', 'cast'); fd.classList.remove('hit');
      if (!await wait(ev.ko ? 500 : 380)) return false;
    }
    for (const p of rec.passives) pop(p.side, p.kind === 'heal' ? '+' + p.amount + ' HP' : p.kind === 'speed' ? '+' + p.amount + ' SPD' : '+' + p.amount + ' DEF', 'buff');
    stageSnap(rec.post, rec.t);
    if (rec.passives.length && !await wait(420)) return false;
    return ok();
  }
  function whySide(name, species, d) {
    const mv = i => '<b>' + esc(G.moveName(species, i)) + '</b>';
    const li = (on, html) => '<li' + (on ? ' class="on"' : '') + '>' + html + '</li>';
    const roll = x => Math.floor(x * 100);
    let lines = '', probs = d.probs, pick = d.modelPick;
    if (d.src === 'HUMAN') {
      lines += li(true, 'You picked ' + mv(d.final) + '.');
      if (d.shadow) lines += li(false, 'The model would have played ' + mv(d.modelPick) + ' (' + pct(probs[d.modelPick]) + ').');
    } else {
      lines += li(d.src === 'MODEL', 'Model wanted ' + mv(d.modelPick) + ' (' + pct(probs[d.modelPick]) + ').');
      if (d.mcts) lines += li(d.src === 'MCTS', 'Planner tried 200 exchanges and ' + (d.mcts.pick === d.modelPick ? 'agreed.' : 'chose ' + mv(d.mcts.pick) + '.'));
      if (d.rule) lines += li(d.src === 'RULE', 'Rule: ' + RULE_TEXT[d.rule.name] + (d.rule.changed ? ', so ' + mv(d.rule.pick) + '.' : '.'));
      if (d.habit) {
        const h = d.habit;
        if (h.eligible) lines += li(h.fired, 'Habit here is ' + mv(h.modal) + ' (' + h.modalCount + ' of ' + h.n + ' picks). It steps in ' + pct(h.p) + ' of the time. Rolled ' + roll(h.roll) + ': ' + (h.fired ? 'habit took over.' : 'no.'));
        else lines += li(false, h.why === 'few' ? (h.n ? 'Only ' + h.n + ' picks taught for this situation. A habit needs 5.' : 'Nothing taught for this situation yet.') : h.why === 'split' ? 'Picks for this situation are split, so no habit.' : 'The habit here is ' + mv(h.modal) + ', but it is used up.');
      }
      if (d.random) lines += li(d.random.fired, 'Random move chance ' + pct(d.random.eps, 1) + '. Rolled ' + roll(d.random.roll) + ': ' + (d.random.fired ? 'random pick, ' + mv(d.random.pick) + '.' : 'no.'));
      lines += li(true, 'Played ' + mv(d.final) + '.');
    }
    let bars = '';
    if (probs) for (let i = 0; i < 4; i++) bars += '<span class="' + (i === pick ? 'pick' : '') + '">' + esc(G.moveName(species, i)) + '</span><span class="bar"><i style="width:' + Math.round(probs[i] * 100) + '%"></i></span><span class="tnum">' + pct(probs[i]) + '</span>';
    return '<div class="why-side"><div class="h"><span class="ellip">' + esc(name) + '</span><span class="chip src-' + d.src + '">' + SRC_LABEL[d.src] + '</span></div><ol>' + lines + '</ol>' + (bars ? '<div class="bars" title="What the model wanted">' + bars + '</div>' : '') + '</div>';
  }
  function banner(html) { const st = $('#stage'); if (!st) return; const old = $('#stage .banner'); if (old) old.remove(); const b = document.createElement('div'); b.className = 'banner'; b.innerHTML = html; st.appendChild(b); }

  // ---------- watch a match ----------
  function startWatch(rec, where) {
    let m; try { m = G.decodeMatchCode(rec.code); } catch (e) { toast('This match record cannot be read'); return; }
    const ia = G.refInfo(m.a), ib = G.refInfo(m.b);
    ui.watch = { rec: rec, where: where || null, m: m, names: [ia.name, ib.name], order: G.matchOrder(ia.starter, ib.starter, m.seed), gi: 0, wins: '', paused: false, skipGame: false, skipAll: false, done: false, from: ui.view === 'watch' ? (ui.watch && ui.watch.from) : ui.view };
    go('watch');
    runWatch(runId);
  }
  function viewWatch() {
    const w = ui.watch; if (!w) return viewArena();
    const dots = [0, 1, 2].map(i => '<i class="' + (w.wins[i] || '') + (i === w.gi && !w.done ? ' now' : '') + '"></i>').join('');
    const sp = state.settings.speed;
    return '<div class="stack"><div class="stack tight"><div class="row between"><span class="eyebrow accent">' + (w.rec.k === 'r' ? 'Ranked match' : w.rec.k === 'c' ? 'Challenge match' : 'Shared match') + '</span><span class="row"><span class="dim small" id="game-label"></span><span class="dots" aria-label="Games won">' + dots + '</span></span></div><h2>' + esc(w.names[0]) + ' <span class="dim">vs</span> ' + esc(w.names[1]) + '</h2></div>' +
      '<div>' + stageHTML() + '</div><div id="watch-under"><div class="controls"><button class="btn small" data-act="w-pause" id="w-pause">Pause</button><div class="seg" role="group" aria-label="Speed">' + [1, 2, 4].map(x => '<button data-act="w-speed" data-x="' + x + '" aria-pressed="' + (sp === x) + '">' + x + 'x</button>').join('') + '</div><button class="btn small ghost" data-act="w-skip-game">Skip game</button><button class="btn small ghost" data-act="w-skip-all">Skip to result</button></div></div>' +
      '<section class="panel"><span class="eyebrow">Why this move</span><div class="why" id="why"><p class="dim">Each round shows what the model wanted and what changed it.</p></div></section></div>';
  }
  async function runWatch(id) {
    const w = ui.watch, ctx = { id: id, names: w.names, speed: () => state.settings.speed, skip: () => w.skipGame || w.skipAll };
    const alive = () => id === runId && ui.watch === w && $('#stage');
    const hold = async ms => { let left = ms; while (left > 0 && alive() && !ctx.skip()) { await sleep(40); if (!w.paused) left -= 40 * ctx.speed(); } return alive(); };
    let wa = 0, wb = 0;
    for (let gi = 0; gi < 3 && wa < 2 && wb < 2; gi++) {
      w.gi = gi; w.skipGame = false;
      const species = w.order[gi], game = G.createMatchGame(w.m, gi, model);
      if (!alive()) return;
      $('#game-label').textContent = 'Game ' + (gi + 1) + ', ' + species + ' vs ' + species;
      document.querySelectorAll('.dots i').forEach((el, i) => { el.className = (w.wins[i] || '') + (i === gi ? ' now' : ''); });
      stageInit(w.names, species); stageSnap({ A: E.snapshot(game.fighters.A), B: E.snapshot(game.fighters.B) }, 1);
      banner('<span class="eyebrow accent">Game ' + (gi + 1) + '</span><b>' + species + ' vs ' + species + '</b><span class="soft small">Same creature on both sides. The brain decides it.</span>');
      if (!await hold(1100)) return;
      const bn = $('#stage .banner'); if (bn) bn.remove();
      while (!game.over) {
        while (w.paused && alive() && !ctx.skip()) await sleep(80);
        if (!alive()) return;
        const rec = game.playRound();
        if (!ctx.skip()) {
          $('#why').innerHTML = whySide(w.names[0], species, rec.dA) + whySide(w.names[1], species, rec.dB);
          if (!await animRound(rec, ctx)) { if (!alive()) return; }
        }
      }
      if (!alive()) return;
      stageSnap({ A: E.snapshot(game.fighters.A), B: E.snapshot(game.fighters.B) }, game.round);
      if (game.winner === 'A') wa++; else wb++;
      w.wins += game.winner;
      document.querySelectorAll('.dots i').forEach((el, i) => { el.className = w.wins[i] || ''; });
      banner('<span class="eyebrow">Game ' + (gi + 1) + (game.timeout ? ', time ran out' : '') + '</span><b>' + esc(w.names[game.winner === 'A' ? 0 : 1]) + ' wins</b><span class="soft small">' + game.round + ' rounds. Games: ' + wa + '-' + wb + '</span>');
      if (!w.skipAll && !await hold(1500)) return;
    }
    if (!alive()) return;
    w.done = true;
    if (!w.rec.seen) { w.rec.seen = true; save(); }
    const won = (w.rec.me === 'A') === (wa > wb), mine = w.rec.k !== 'v';
    const next = nextUnseen();
    const consistent = w.wins === w.m.winners;
    $('#watch-under').innerHTML = '<section class="panel result"><span class="eyebrow">' + (mine ? (won ? 'Your brain won' : 'Your brain lost') : 'Final') + '</span><div class="score ' + (mine ? (won ? 'win' : 'loss') : '') + '">' + wa + ' - ' + wb + '</div>' +
      (w.rec.k === 'r' ? '<div class="row" style="justify-content:center"><span class="chip gold">' + G.tierOf(w.rec.r1) + '</span><span class="rating">' + w.rec.r0 + ' to ' + w.rec.r1 + ' (' + (w.rec.r1 >= w.rec.r0 ? '+' : '') + (w.rec.r1 - w.rec.r0) + ')</span></div>' : '') +
      (consistent ? '' : '<p class="note bad">This replay did not match the result claimed in the code.</p>') +
      '<div class="row" style="justify-content:center">' + (next ? '<button class="btn primary" data-act="watch-next">Next match</button>' : '') + '<button class="btn" data-act="copy-match">Copy match ' + (CFG.links === 'hash' ? 'link' : 'code') + '</button><button class="btn ghost" data-act="w-again">Watch again</button><button class="btn ghost" data-act="nav" data-view="' + (mine ? 'arena' : 'check') + '">Back</button></div>' +
      (mine && !won ? '<p class="dim small">Lost on a habit you do not like? Teach that situation again. Habits can be overwritten.</p>' : '') + '</section>';
  }
  function nextUnseen() { const c = state.days[S.today()]; if (!c) return null; for (let i = 0; i < 3; i++) if (c.done[i] && !c.done[i].seen) return { rec: c.done[i], where: { day: S.today(), slot: i } }; return null; }

  // ---------- teach ----------
  function viewTeach() {
    if (!state.onboarded) return '<section class="panel stack"><h1>Teach</h1><p class="soft">Create your brain first.</p><div><button class="btn primary" data-act="onboard">Create your brain</button></div></section>';
    const t = ui.teach, p = S.profileOf(state), day = S.today(), credits = p.creditsDay === day ? p.creditsToday : 0;
    if (t.phase === 'setup') {
      t.me = t.me || state.starter; t.opp = t.opp || state.starter; t.level = t.level || state.settings.level;
      const pick = (key, cur) => '<div class="seg" role="group">' + G.SPECIES.map(s => '<button data-act="t-set" data-k="' + key + '" data-v="' + s + '" aria-pressed="' + (cur === s) + '">' + s + '</button>').join('') + '</div>';
      return '<div class="cols two"><section class="panel stack"><div><h1>Teach</h1><p class="soft">Play a real battle yourself. Every move you pick is remembered for the situation you picked it in. Pick the same move five times in one situation and it becomes a habit.</p></div>' +
        '<div class="field"><label>You play</label>' + pick('me', t.me) + '</div><div class="field"><label>Against</label>' + pick('opp', t.opp) + '<span class="dim small">Ranked games use the same creature on both sides. Other matchups teach situations your brain will meet in Capmon World.</span></div>' +
        '<div class="field"><label>Sparring partner</label><div class="seg" role="group">' + LEVELS.map(l => '<button data-act="t-set" data-k="level" data-v="' + l[0] + '" aria-pressed="' + (t.level === l[0]) + '">' + l[1] + ', ' + G.ROSTER_BY_ID[l[0]].name + '</button>').join('') + '</div></div>' +
        '<button class="btn primary wide" data-act="t-start">Start battle</button></section>' +
        '<section class="panel stack"><span class="eyebrow">Today</span><div class="stats"><div class="stat"><b>' + credits + '<small class="dim" style="font-size:14px"> / ' + E.DAILY_CAP + '</small></b><span>new situations learned today</span></div><div class="stat"><b>' + state.teach.battles + '</b><span>teaching battles</span></div><div class="stat"><b>' + state.teach.moves + '</b><span>moves taught</span></div></div>' +
        '<p class="note">A brain can learn 8 new situations a day. After that, picks still strengthen or change habits it already has.</p><p class="note">Winning is not the point here. Your choices are.</p></section></div>';
    }
    const sp = t.me, usable = t.game && !t.game.over ? E.usableMoves(t.game.fighters.A) : [];
    const desc = ['Normal, power 30. Critical hits more often.', TYPE_NAME[E.SPECIES[sp].type] + ', power 30, with a same-type bonus.', 'No damage. Lowers their defense, up to 65%.', TYPE_NAME[E.SPECIES[sp].type] + ', power 60. One use per battle.'];
    const moves = [0, 1, 2, 3].map(i => '<button class="move mc-' + moveType(sp, i) + '" data-act="t-move" data-m="' + i + '"' + (t.busy || usable.indexOf(i) < 0 ? ' disabled' : '') + '><b>' + esc(G.moveName(sp, i)) + '</b><span>' + (usable.indexOf(i) < 0 && t.game && !t.game.over ? 'Used up.' : desc[i]) + '</span></button>').join('');
    const under = t.phase === 'done' ? teachDone() : '<div class="moves" id="t-moves">' + moves + '</div>';
    return '<div class="stack"><div class="row between"><div><div class="eyebrow accent">Teaching battle</div><h2>' + esc(state.name) + ' <span class="dim">vs</span> ' + esc(G.ROSTER_BY_ID[t.level].name) + '</h2></div><button class="btn small ghost" data-act="t-quit">Leave</button></div><div>' + stageHTML() + '</div><div id="t-under">' + under + '</div>' +
      '<section class="panel"><span class="eyebrow">What your brain is learning</span><div id="lesson">' + (t.lesson || '<p class="dim">Pick a move. Both sides choose at the same time, then the faster creature goes first.</p>') + '</div></section></div>';
  }
  function teachDone() {
    const t = ui.teach, won = t.game.winner === 'A', s = G.brainSummary(S.profileOf(state));
    return '<section class="panel result"><span class="eyebrow">' + (won ? 'You won' : 'You lost') + ' in ' + t.game.round + ' rounds</span><div class="stats" style="width:100%"><div class="stat"><b>' + t.count + '</b><span>moves taught</span></div><div class="stat"><b>+' + t.newCovered + '</b><span>situations learned</span></div><div class="stat"><b>' + s.habits + '</b><span>habits in total</span></div></div>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-act="t-again">Teach again</button><button class="btn" data-act="nav" data-view="arena">Go to the arena</button><button class="btn ghost" data-act="nav" data-view="brain">See the brain</button></div></section>';
  }
  function teachStart() {
    const t = ui.teach; state.teach.salt++; state.settings.level = t.level; save();
    const salt = new Uint8Array(6); try { crypto.getRandomValues(salt); } catch (e) { /* seed still unique by counter */ }
    Object.assign(t, { phase: 'battle', busy: false, lesson: '', count: 0, newCovered: 0, id: ++runId,
      game: E.createGame({ seed: ['teach', state.id, state.teach.salt, E.b64urlEncode(salt)].join('|'), a: { species: t.me, brain: { kind: 'human', shadow: { kind: 'spec', eps: 0 } } }, b: { species: t.opp, brain: G.ROSTER_BY_ID[t.level].brain }, model: model }) });
    render(); teachRestore();
  }
  async function teachMove(m) {
    const t = ui.teach; if (t.busy || !t.game || t.game.over) return;
    let rec; try { rec = t.game.playRound({ A: m }); } catch (e) { return; }
    t.busy = true;
    const p = S.profileOf(state), day = S.today(), b = rec.dA.bucket, d = G.describeBucket(b);
    const fresh = E.recordTurn(p, b, m, day);
    S.setProfile(state, p); state.teach.moves++; t.count++; if (fresh) t.newCovered++; save();
    const n = E.bucketTotal(p, b), h = E.habitInfo(p, b, null), mine = p.counts[b * E.ACTIONS + m];
    let status;
    if (fresh) status = '<span class="chip win">New situation learned, ' + p.creditsToday + ' of ' + E.DAILY_CAP + ' today</span>';
    else if (!p.covered[b] && n >= E.MIN_COVER) status = '<span class="chip">Daily limit reached. It will count tomorrow</span>';
    else if (!p.covered[b]) status = '<span class="chip">' + (E.MIN_COVER - n) + ' more to learn this situation</span>';
    else status = '<span class="chip accent">Known situation</span>';
    const habit = h.eligible ? 'Habit here: <b>' + esc(G.moveName(t.me, h.modal)) + '</b>, stepping in ' + pct(h.p) + ' of the time.' : (n < E.MIN_BUCKET ? (E.MIN_BUCKET - n) + ' more picks here before a habit can form.' : 'Your picks here are split, so there is no habit yet.');
    t.lesson = '<div class="stack tight"><div class="row">' + status + '<span class="dim small">You at ' + d.own + ' HP, opponent at ' + d.opp + ', ' + d.phase.toLowerCase() + ', type matchup ' + d.rel + '</span></div><p>You picked <b>' + esc(G.moveName(t.me, m)) + '</b> (' + mine + ' of ' + n + ' picks in this situation). The model would have played <b>' + esc(G.moveName(t.me, rec.dA.modelPick)) + '</b> (' + pct(rec.dA.probs[rec.dA.modelPick]) + ').</p><p class="soft">' + habit + '</p></div>';
    $('#lesson').innerHTML = t.lesson;
    document.querySelectorAll('#t-moves .move').forEach(el => { el.disabled = true; });
    const id = t.id, ok = await animRound(rec, { id: id, names: [state.name, G.ROSTER_BY_ID[t.level].name], speed: () => 1, skip: () => false });
    void ok;
    if (id !== runId || ui.view !== 'teach' || ui.teach !== t) return;
    t.busy = false; teachSettle();
    const sc = window.scrollY; render(); teachRestore(); window.scrollTo(0, sc);
  }
  function teachSettle() {
    const t = ui.teach;
    if (t.game && t.game.over && t.phase === 'battle') { t.phase = 'done'; state.teach.battles++; if (t.game.winner === 'A') state.teach.wins++; save(); }
  }

  // ---------- brain ----------
  const MOVE_COLOR = ['var(--normal)', 'var(--accent)', 'var(--violet)', 'var(--gold)'];
  function viewBrain() {
    if (!state.onboarded) return '<section class="panel stack"><h1>Brain</h1><p class="soft">Create your brain first.</p><div><button class="btn primary" data-act="onboard">Create your brain</button></div></section>';
    const p = S.profileOf(state), s = G.brainSummary(p), rel = ui.brainRel;
    let grid = '<div class="hd"></div>';
    for (let o = 2; o >= 0; o--) grid += '<div class="gh">Opponent ' + E.OPP_LABELS[o] + '</div>';
    grid += '<div class="hd">You</div>';
    for (let o = 2; o >= 0; o--) for (let ph = 0; ph < 3; ph++) grid += '<div class="hd">' + ['R1-3', 'R4-8', 'R9+'][ph] + '</div>';
    for (let own = 3; own >= 0; own--) {
      grid += '<div class="rh">' + E.OWN_LABELS[own] + '</div>';
      for (let o = 2; o >= 0; o--) for (let ph = 0; ph < 3; ph++) {
        const b = ((own * 3 + o) * 3 + rel) * 3 + ph, n = E.bucketTotal(p, b), h = E.habitInfo(p, b, null);
        grid += '<button class="cell' + (n ? ' taught' : '') + (p.covered[b] ? ' covered' : '') + (h.eligible ? ' habit' : '') + '" style="--mc:' + (n ? MOVE_COLOR[h.modal] : 'transparent') + ';--a:' + (n ? Math.min(1, 0.25 + n / 16).toFixed(2) : 0) + '" data-act="b-cell" data-b="' + b + '" aria-pressed="' + (ui.brainCell === b) + '" aria-label="Situation ' + b + ', ' + n + ' picks"></button>';
      }
    }
    let detail = '<p class="dim">Tap a square to see what your brain does there. Rows are your HP. Columns are the HP of the opponent and the round.</p>';
    if (ui.brainCell >= 0) {
      const b = ui.brainCell, d = G.describeBucket(b), n = E.bucketTotal(p, b), h = E.habitInfo(p, b, null);
      detail = '<div class="stack tight"><b>You at ' + d.own + ' HP, opponent at ' + d.opp + ', ' + d.phase.toLowerCase() + '</b><div class="row">' + [0, 1, 2, 3].map(a => '<span class="chip" style="border-color:' + MOVE_COLOR[a] + '">' + G.MOVE_SLOT_NAMES[a] + ' ' + p.counts[b * E.ACTIONS + a] + '</span>').join('') + '</div><p class="soft">' +
        (n === 0 ? 'Nothing taught here. The brain follows the model, with ' + pct(s.randomness, 1) + ' random moves.' : h.eligible ? 'Habit: ' + G.MOVE_SLOT_NAMES[h.modal] + '. It replaces the model\'s pick ' + pct(h.p) + ' of the time.' : n < E.MIN_BUCKET ? n + ' of 5 picks needed for a habit.' : 'Picks are split. No move has half of them, so there is no habit.') + (p.covered[b] ? ' This situation counts as learned.' : '') + '</p></div>';
    }
    const code = G.encodeBrainCode(myRef());
    return '<div class="stack"><div class="row between"><div class="who">' + crea(state.starter, 'big') + '<div><h1 class="ellip">' + esc(state.name) + '</h1><span class="dim">The 58M-step Capmon model plus your habits</span></div></div></div>' +
      '<div class="stats"><div class="stat"><b>' + s.habits + '</b><span>habits formed</span></div><div class="stat"><b>' + s.covered + '<small class="dim" style="font-size:14px"> / ' + s.target + '</small></b><span>situations learned</span></div><div class="stat"><b>' + pct(s.randomness, 1) + '</b><span>random moves</span></div><div class="stat"><b>' + s.samples + '</b><span>picks remembered</span></div></div>' +
      '<div class="cols two"><section class="panel stack"><div class="row between"><span class="eyebrow">Habit map</span><div class="seg" role="group" aria-label="Type matchup">' + [[1, 'Even'], [0, 'Advantage'], [2, 'Disadvantage']].map(x => '<button data-act="b-rel" data-r="' + x[0] + '" aria-pressed="' + (rel === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      '<div class="grid-wrap"><div class="bgrid">' + grid + '</div></div><div class="legend">' + [0, 1, 2, 3].map(a => '<span><i style="--mc:' + MOVE_COLOR[a] + '"></i>' + G.MOVE_SLOT_NAMES[a] + '</span>').join('') + '<span>Bright border: learned</span><span>Dot: habit</span></div><div id="b-detail">' + detail + '</div></section>' +
      '<div class="stack"><section class="panel stack"><span class="eyebrow">How it decides</span><p class="soft">1. The model picks a move. 2. If you taught a habit for the situation, the habit can replace that pick, at most 35% of the time. 3. A random move can replace both. Randomness starts at 40% and falls to 20% as the brain learns 60 situations.</p></section>' +
      '<section class="panel stack"><span class="eyebrow">Brain code</span><p class="soft small">Your whole brain as text. Use it to move to another device or to challenge a friend.</p><textarea class="input" id="brain-code" readonly rows="3">' + esc(code) + '</textarea><div class="row"><button class="btn small" data-act="copy-code">Copy code</button><button class="btn small ghost" data-act="open-code">Load a code</button><button class="btn small ghost" data-act="b-reset">' + (ui.resetArmed ? 'Tap again to erase everything' : 'Reset') + '</button></div></section></div></div></div>';
  }

  // ---------- codes: challenge, import, check ----------
  function openCodeSheet(prefill) {
    openOverlay('<div class="stack"><h2>Open a code</h2><p class="soft">Paste a brain code or a match ' + (CFG.links === 'hash' ? 'link' : 'code') + '.</p><textarea class="input" id="code-in" rows="4" placeholder="b1... or m1...">' + esc(prefill || '') + '</textarea><p class="note bad" id="code-err" hidden></p><div class="row"><button class="btn primary" data-act="code-go">Open</button><button class="btn ghost" data-act="close">Cancel</button></div></div>');
  }
  function handleCode(text) {
    const code = G.findCode(text);
    if (!code) return 'That does not look like a brain code or a match code.';
    try {
      if (code.slice(0, 2) === 'b1') { const ref = G.decodeBrainCode(code); showBrainSheet(ref); return null; }
      const m = G.decodeMatchCode(code); closeOverlay(); ui.check = { code: code, m: m, result: G.verifyMatchCode(code, model) }; go('check'); return null;
    } catch (e) { return 'This code is damaged: ' + e.message + '.'; }
  }
  function showBrainSheet(ref) {
    const s = G.brainSummary(E.profileFromCode(ref.code));
    ui.sheetRef = ref;
    openOverlay('<div class="stack"><div class="who">' + crea(ref.starter, 'big') + '<div class="grow"><div class="eyebrow accent">Brain code</div><h2 class="ellip">' + esc(ref.name) + '</h2></div></div><div class="stats"><div class="stat"><b>' + s.habits + '</b><span>habits</span></div><div class="stat"><b>' + s.covered + '</b><span>situations learned</span></div><div class="stat"><b>' + pct(s.randomness) + '</b><span>random moves</span></div></div>' +
      (state.onboarded ? '<button class="btn primary wide" data-act="ch-play">Play my brain against it</button><button class="btn ghost wide" data-act="ch-import">' + (ui.importArmed ? 'Tap again: this replaces my habits' : 'Use this as my brain') + '</button>' : '<p class="note accent">' + esc(ref.name) + ' wants a match. Create your brain and it plays right away.</p><button class="btn primary wide" data-act="ch-onboard">Create my brain</button>') +
      '<button class="btn ghost wide" data-act="close">Close</button></div>');
  }
  function playChallenge(ref) {
    const salt = new Uint8Array(9); try { crypto.getRandomValues(salt); } catch (e) { for (let i = 0; i < 9; i++) salt[i] = Math.floor(Math.random() * 256); }
    const m = { seed: 'ch|' + E.b64urlEncode(salt), a: myRef(), b: ref }, res = G.playMatch(m, model);
    const rec = { k: 'c', day: S.today(), code: G.encodeMatchCode({ seed: m.seed, a: m.a, b: m.b, winners: res.winners }), me: 'A', won: res.winner === 'A', score: res.score.join('-'), opp: ref.name, oppId: '', r0: state.rating, r1: state.rating, seen: false, at: Date.now() };
    state.log.push(rec); save(); closeOverlay(); startWatch(state.log[state.log.length - 1], null);
  }
  function viewCheck() {
    let verdict = '';
    const c = ui.check;
    if (c && c.result) {
      const r = c.result, ia = G.refInfo(c.m.a), ib = G.refInfo(c.m.b);
      verdict = '<section class="panel stack"><div class="row between"><h2 class="ellip">' + esc(ia.name) + ' <span class="dim">vs</span> ' + esc(ib.name) + '</h2><span class="chip ' + (r.ok ? 'win' : 'loss') + '">' + (r.ok ? 'Replay matches' : 'Replay differs') + '</span></div>' +
        '<p class="' + (r.ok ? 'note good' : 'note bad') + '">' + (r.ok ? 'This browser re-ran every game from the code and got the same winners: ' + r.replayed.split('').map((x, i) => 'game ' + (i + 1) + ' ' + esc(x === 'A' ? ia.name : ib.name)).join(', ') + '.' : 'The code claims ' + esc(r.claimed) + ' but re-running it here gives ' + esc(r.replayed) + '. The result in this code was changed, or it was made with a different version.') + '</p>' +
        '<div class="row"><button class="btn primary" data-act="check-watch">Watch it</button><span class="dim small">Final score ' + r.match.score.join('-') + '</span></div></section>';
    }
    const sc = ui.selfcheck;
    return '<div class="stack"><div><h1>Replay check</h1><p class="soft">A match is fully decided by its code: the dice seed and both brains. Anyone can re-run it and must get the same result. Nothing is taken on trust and nothing is stored on a server.</p></div>' +
      '<section class="panel stack"><div class="field"><label for="check-in">Match ' + (CFG.links === 'hash' ? 'link or code' : 'code') + '</label><textarea class="input" id="check-in" rows="3" placeholder="m1...">' + esc(c && c.code ? c.code : '') + '</textarea></div><p class="note bad" id="check-err" hidden></p><div><button class="btn primary" data-act="check-go">Re-run this match</button></div></section>' + verdict +
      '<section class="panel stack"><span class="eyebrow">This device</span><p class="soft">Replays only mean something if every device computes the same battle. This test plays 12 fixed games and compares a fingerprint with the reference.</p>' +
      (sc ? '<p class="note ' + (sc.ok ? 'good' : 'bad') + '">' + (sc.ok ? 'Pass. This device computes battles exactly like the reference (' + sc.ms + ' ms).' : 'Fail. This browser computes battles differently, so replays made elsewhere may not match here. Please report your browser version.') + '<br><span class="mono dim">' + esc(sc.hash.slice(0, 16)) + '</span></p>' : '') +
      '<div><button class="btn" data-act="selfcheck">' + (ui.selfBusy ? 'Running' : 'Run the device test') + '</button></div><p class="dim small">Engine ' + esc(E.ENGINE_ID) + '. Model ' + esc(model.id.slice(0, 12)) + ', the 58M-step network from Capmon World, run as plain arithmetic in this page.</p></section></div>';
  }

  // ---------- actions ----------
  const ACT = {
    nav: el => { const t = ui.teach; if (el.dataset.view === 'teach' && ui.view !== 'teach' && t.phase === 'done') ui.teach = { phase: 'setup', me: t.me, opp: t.opp, level: t.level }; go(el.dataset.view); },
    reload: () => location.reload(),
    close: () => { ui.importArmed = false; closeOverlay(); },
    onboard: () => showOnboarding(),
    'ob-starter': el => { ui.ob.name = $('#ob-name').value; ui.ob.starter = el.dataset.s; showOnboarding(); },
    'play-card': () => { if (!ui.busy) playCard(); },
    'reveal-card': () => { const c = state.days[S.today()]; if (c) c.done.forEach(r => { if (r) r.seen = true; }); save(); render(); },
    'watch-rec': el => { const rec = el.dataset.log != null ? state.log[+el.dataset.log] : (state.days[el.dataset.day] || { done: [] }).done[+el.dataset.slot]; if (rec) startWatch(rec, el.dataset.day ? { day: el.dataset.day, slot: +el.dataset.slot } : null); },
    'watch-next': () => { const n = nextUnseen(); if (n) startWatch(n.rec, n.where); },
    'w-pause': el => { const w = ui.watch; if (!w) return; w.paused = !w.paused; el.textContent = w.paused ? 'Play' : 'Pause'; },
    'w-speed': el => { state.settings.speed = +el.dataset.x; save(); document.querySelectorAll('[data-act="w-speed"]').forEach(b => b.setAttribute('aria-pressed', String(b === el))); },
    'w-skip-game': () => { if (ui.watch) ui.watch.skipGame = true; },
    'w-skip-all': () => { if (ui.watch) ui.watch.skipAll = true; },
    'w-again': () => { if (ui.watch) startWatch(ui.watch.rec, ui.watch.where); },
    'copy-match': () => { if (ui.watch) copyText(linkFor('m', ui.watch.rec.code), CFG.links === 'hash' ? 'Match link copied' : 'Match code copied'); },
    'copy-challenge': () => copyText(linkFor('c', G.encodeBrainCode(myRef())), CFG.links === 'hash' ? 'Challenge link copied' : 'Brain code copied'),
    'copy-code': () => copyText(G.encodeBrainCode(myRef()), 'Brain code copied'),
    'open-code': () => openCodeSheet(),
    'code-go': () => { const err = handleCode($('#code-in').value); if (err) { const e = $('#code-err'); e.textContent = err; e.hidden = false; } },
    'ch-play': () => playChallenge(ui.sheetRef),
    'ch-onboard': () => { const ref = ui.sheetRef; closeOverlay(); showOnboarding(() => playChallenge(ref)); },
    'ch-import': () => { if (!ui.importArmed) { ui.importArmed = true; showBrainSheet(ui.sheetRef); return; } ui.importArmed = false; state.brain = ui.sheetRef.code; save(); closeOverlay(); go('brain'); toast('Brain loaded'); },
    't-set': el => { ui.teach[el.dataset.k] = el.dataset.v; render(); },
    't-start': () => teachStart(),
    't-move': el => teachMove(+el.dataset.m),
    't-again': () => { ui.teach = { phase: 'setup', me: ui.teach.me, opp: ui.teach.opp, level: ui.teach.level }; render(); },
    't-quit': () => { runId++; ui.teach = { phase: 'setup', me: ui.teach.me, opp: ui.teach.opp, level: ui.teach.level }; render(); },
    'b-rel': el => { ui.brainRel = +el.dataset.r; ui.brainCell = -1; render(); },
    'b-cell': el => { ui.brainCell = +el.dataset.b; render(); },
    'b-reset': () => { if (!ui.resetArmed) { ui.resetArmed = true; render(); setTimeout(() => { if (ui.resetArmed) { ui.resetArmed = false; if (ui.view === 'brain') render(); } }, 4000); return; } ui.resetArmed = false; S.wipe(); state = S.load(); ui.teach = { phase: 'setup' }; ui.watch = null; go('arena'); showOnboarding(); },
    'check-go': () => { const text = $('#check-in').value, code = G.findCode(text); const e = $('#check-err'); if (!code || code.slice(0, 2) !== 'm1') { e.textContent = 'Paste a match code. It starts with m1.'; e.hidden = false; return; } const r = G.verifyMatchCode(code, model); if (r.error) { e.textContent = 'This code is damaged: ' + r.error + '.'; e.hidden = false; return; } ui.check = { code: code, m: G.decodeMatchCode(code), result: r }; render(); },
    'check-watch': () => { const c = ui.check; if (c) startWatch({ k: 'v', code: c.code, me: 'A', seen: true }, null); },
    selfcheck: () => { if (ui.selfBusy) return; ui.selfBusy = true; render(); setTimeout(() => { const r = window.CapmonSelfCheck.run(E, model, 12); ui.selfcheck = { ok: !!window.CAPMON_EXPECTED && r.hash === window.CAPMON_EXPECTED.selfcheck, hash: r.hash, ms: r.ms }; ui.selfBusy = false; if (ui.view === 'check') render(); }, 60); }
  };
  function teachRestore() {
    const t = ui.teach; if (!t.game || !$('#stage')) return;
    stageInit([state.name, G.ROSTER_BY_ID[t.level].name], t.me); $('#fB').innerHTML = crea(t.opp);
    stageSnap({ A: E.snapshot(t.game.fighters.A), B: E.snapshot(t.game.fighters.B) }, t.game.over ? t.game.round : t.game.round + 1);
    if (t.game.over) banner('<b>' + (t.game.winner === 'A' ? 'You win' : esc(G.ROSTER_BY_ID[t.level].name) + ' wins') + '</b>');
  }
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act]; if (fn) { ev.preventDefault(); fn(el); }
  });
  document.addEventListener('submit', ev => { ev.preventDefault(); if (ev.target.id === 'ob-form') finishOnboarding(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ui.overlay && state.onboarded) closeOverlay(); });

  // ---------- boot ----------
  function fromHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (h.slice(0, 2) === 'c=' || h.slice(0, 2) === 'm=') { try { history.replaceState(null, '', '#arena'); } catch (e) { /* ignore */ } return { code: h.slice(2) }; }
    return VIEWS.indexOf(h) >= 0 ? { view: h } : {};
  }
  async function loadModel() {
    let bytes;
    if (window.CAPMON_BRAIN_B64) bytes = E.b64urlDecode(window.CAPMON_BRAIN_B64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    else {
      const res = await fetch(CFG.brainUrl);
      if (!res.ok) throw new Error('The model file could not be downloaded (' + res.status + ').');
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const m = E.createModel(bytes);
    if (window.CAPMON_EXPECTED && m.id !== window.CAPMON_EXPECTED.model) throw new Error('The model file does not match this version of the game.');
    return m;
  }
  async function boot() {
    const start = fromHash();
    if (start.view) ui.view = start.view;
    render();
    try { model = await loadModel(); } catch (e) { ui.loadError = e && e.message ? e.message : 'Unknown error.'; render(); return; }
    render();
    if (start.code) { const err = handleCode(start.code); if (err) toast(err); }
    else if (!state.onboarded) showOnboarding();
    window.addEventListener('hashchange', () => { const h = fromHash(); if (h.code) { const err = handleCode(h.code); if (err) toast(err); } else if (h.view && h.view !== ui.view) go(h.view); });
  }
  window.CapmonArena = { state: () => state, ui: ui, model: () => model };
  boot();
})();
