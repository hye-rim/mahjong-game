'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 마작: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_MJ). 혼자 하기는 이 파일이 규칙을 직접 돌리고, 온라인은 서버가 돌린 상태를 받아 그린다.
const L = LOGIC_MJ;
const $ = (id) => document.getElementById(id);
const SUIT = ['만', '통', '삭'], HON = ['동', '남', '서', '북', '백', '발', '중'], WIND = ['동', '남', '서', '북'];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('mahjongMuted') === '1';
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'triangle', vol = 0.06) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  click: () => tone(520, 0.03, 'square', 0.025), discard: () => tone(260, 0.06, 'square', 0.05, -80), call: () => melody([523, 784], 70, 'triangle', 0.06),
  riichi: () => melody([392, 523, 659], 80, 'sawtooth', 0.04), dora: () => tone(1100, 0.1, 'sine', 0.05), bad: () => tone(150, 0.1, 'square', 0.04),
  win: () => melody([523, 659, 784, 1047, 1319], 100), lose: () => melody([392, 330, 262], 150, 'sawtooth', 0.04), draw: () => melody([440, 440], 120, 'sine', 0.05),
};

// ---------- 상태 ----------
let G = null, state = 'title', level = 'normal', tut = false, tutStage = 0, tutRigged = false;
let online = false, room = null, ME = 0, netDown = false, claimSent = false, shownKey = '', readyKey = '', finalKey = '', recvAt = 0;
let sel = null, riichiMode = false, timer = null, evIdx = 0, finalDone = false;
let wins = Number(store.get('mahjongWins')) || 0;
const TUT_JUNK = 33;                               // 튜토리얼 첫 버릴 패: 중
const SESSION_KEY = 'mahjongOnline';
const loadSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } };
const saveSession = (v) => { try { v ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} };
const myName = () => { const n = (store.get('mahjongName') || '').trim().slice(0, 8); return n || `손님${Math.floor(100 + Math.random() * 900)}`; };

/* @test-hooks:start */
window.__mj = { get G() { return G; }, get state() { return state; }, get online() { return online; }, get room() { return room; }, L, run: () => run(), set(g) { G = g; }, get sel() { return sel; } };
/* @test-hooks:end */

// ---------- 화면에 그릴 상태(view): 혼자 하기는 G 에서, 온라인은 서버가 보낸 것에서 ----------
function viewOf() {
  if (online) return room && room.g ? room.g : null;
  if (!G) return null;
  const st = G, myTurn = st.phase === 'act' && st.turn === 0, o = myTurn ? L.actOptions(st) : null;
  const n = st.hands[0].reduce((a, b) => a + b, 0), tenpaiShape = n === 13 - 3 * st.melds[0].length;
  return {
    names: st.names, hand: st.hand, honba: st.honba, dealer: st.dealer, wall: st.wall.length, ind: L.doraIndicators(st), scores: st.scores, sticks: st.sticks,
    rivers: st.rivers, melds: st.melds, riichi: st.riichi, phase: st.phase, turn: st.turn, last: st.lastDiscard, over: st.over,
    mine: st.hands[0], drawn: myTurn ? st.drawn : null,
    opts: o ? { tsumo: o.tsumo ? { han: o.tsumo.han, yakuman: o.tsumo.yakuman } : null, riichi: o.riichi, ankan: o.ankan, shouminkan: o.shouminkan, discard: o.discard } : null,
    claim: st.phase === 'claim' && st.claims[0] ? st.claims[0] : null,
    furiten: tenpaiShape && L.waitsNow(st, 0).length > 0 ? L.isFuriten(st, 0) : false, waits: tenpaiShape ? L.waitsNow(st, 0) : [],
    seatInfo: [0, 1, 2, 3].map((p) => ({ human: p === 0, online: true, auto: false })), waiting: [], ready: [], result: st.phase === 'end' || st.phase === 'over' ? L.withReveal(st) : null, remain: 0,
  };
}

// ---------- 그리기 ----------
function tileHTML(t, cls = '') {
  if (t < 27) { const k = Math.floor(t / 9); return `<span class="t ${'mps'[k]} ${cls}" data-t="${t}"><b>${(t % 9) + 1}</b><i>${SUIT[k]}</i></span>`; }
  const h = t - 27, c = h >= 4 ? ['d1', 'd2', 'd3'][h - 4] : '';
  return `<span class="t h ${c} ${cls}" data-t="${t}"><b>${HON[h]}</b></span>`;
}
const backHTML = (cls = '') => `<span class="t back ${cls}"></span>`;
function meldHTML(m, cls) {
  if (m.kind === 'ankan') return `<span>${backHTML(cls)}${tileHTML(m.tiles[0], cls)}${tileHTML(m.tiles[0], cls)}${backHTML(cls)}</span>`;
  return `<span>${m.tiles.map((t) => tileHTML(t, cls)).join('')}</span>`;
}
const handTiles = (c, skip) => { const out = []; for (let t = 0; t < 34; t++) for (let i = 0; i < c[t]; i++) out.push(t); if (skip != null) { const k = out.lastIndexOf(skip); if (k >= 0) out.splice(k, 1); } return out; };
const seatName = (v, p) => (WIND[(p - v.dealer + 4) % 4]);

function render() {
  const v = viewOf();
  if (!v) return;
  if (!online) processLocalEvents();
  const me = ME, myTurn = v.phase === 'act' && v.turn === me;
  $('info').textContent = `동${Math.min(4, v.hand + 1)}국${v.honba ? ` ${v.honba}본장` : ''} · 내 자리 ${seatName(v, me)} · 남은 패 ${v.wall}${v.sticks ? ` · 리치봉 ${v.sticks}` : ''}`;
  $('dora').innerHTML = `<small>도라</small>` + [0, 1, 2, 3, 4].map((i) => (i < v.ind.length ? tileHTML(v.ind[i], 'xs') : backHTML('xs'))).join('');
  // 강: 내가 아래, 맞은편 위, 왼쪽·오른쪽은 차례 순서대로
  const panel = (p, cls) => {
    const info = v.seatInfo[p] || {};
    const turn = v.phase !== 'end' && v.phase !== 'over' && (v.phase === 'act' ? v.turn === p : v.last && v.last.p === p);
    const tag = online ? (info.human === false ? ' 🤖' : info.online === false ? ' · 끊김' : info.auto ? ' 🤖' : '') : '';
    return `<div class="pn ${cls} ${turn ? 'turn' : ''}"><div class="hd"><span>${p === me ? '👉 ' : ''}${esc(v.names[p])} · ${seatName(v, p)}${p === v.dealer ? ' (친)' : ''}${tag} ${v.riichi[p] ? '<span class="rc">리치</span>' : ''}</span><span class="sc">${v.scores[p].toLocaleString()}</span></div>
      <div class="river">${v.rivers[p].map((r) => tileHTML(r.t, `sm ${r.riichi ? 'rt' : ''} ${r.called ? 'called' : ''}`)).join('')}</div>
      ${v.melds[p].length ? `<div class="melds">${v.melds[p].map((m) => meldHTML(m, 'xs')).join('')}</div>` : ''}</div>`;
  };
  $('table').innerHTML = panel((me + 2) % 4, 'top') + panel((me + 3) % 4, '') + panel((me + 1) % 4, '') + panel(me, 'top');
  // 내 손
  const drawn = v.drawn != null ? v.drawn : null;
  const allowed = v.opts ? (riichiMode ? v.opts.riichi : v.opts.discard) : [];
  const tileCls = (t) => `${sel === t ? 'sel' : ''} ${myTurn && v.opts && !allowed.includes(t) ? 'dis' : ''} ${tut && tutStage === 0 && t === TUT_JUNK ? 'hint' : ''}`;
  const tiles = handTiles(v.mine, drawn);
  let html = tiles.map((t) => tileHTML(t, tileCls(t))).join('');
  if (drawn != null) html += `<span class="gap"></span>` + tileHTML(drawn, tileCls(drawn));
  $('hand').innerHTML = html;
  $('myMelds').innerHTML = v.melds[me].map((m) => meldHTML(m, '')).join('');
  renderActs(v);
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
  $('pauseBtn').style.display = online ? 'none' : '';
}

function renderActs(v) {
  const box = $('acts');
  let msg = '', btns = [];
  const btn = (a, label, cls = '', small = '') => `<button data-a="${a}" class="${cls}">${label}${small ? `<small>${small}</small>` : ''}</button>`;
  const secs = online && room && room.g.remain ? ` · ${Math.max(0, Math.ceil((room.g.remain - (performance.now() - recvAt)) / 1000))}초` : '';
  if (v.phase === 'act' && v.turn === ME && v.opts) {
    const o = v.opts;
    if (o.tsumo) btns.push(btn('tsumo', '쯔모', 'go', o.tsumo.yakuman ? '역만' : `${o.tsumo.han}판`));
    if (o.riichi.length) btns.push(riichiMode ? btn('riichiOff', '리치 취소', 'on') : btn('riichi', '리치', 'warn'));
    o.ankan.forEach((t) => btns.push(btn(`kan:${t}`, '깡', '', L.tileName(t))));
    o.shouminkan.forEach((t) => btns.push(btn(`kan:${t}`, '깡', '', L.tileName(t))));
    btns.push(btn('discard', '버리기', 'go'));
    msg = riichiMode ? '리치할 패를 고르세요 (밝은 패만 가능). 한 번 더 누르면 리치!' : v.riichi[ME] ? '리치 중: 쯔모할 수 있으면 쯔모, 아니면 뽑은 패가 자동으로 버려져요' : v.drawn == null ? '불러온 뒤에는 패를 한 장 버려야 해요' : '버릴 패를 누르세요 (한 번 더 누르거나 [버리기])';
    msg += secs;
  } else if (v.phase === 'claim' && v.claim && !claimSent) {
    const cl = v.claim, t = v.last.t;
    if (cl.ron) btns.push(btn('ron', '론!', 'go', '이겼어요'));
    if (cl.kan) btns.push(btn('kan', '깡'));
    if (cl.pon) btns.push(btn('pon', '퐁'));
    if (cl.chi) cl.chi.forEach((ch) => btns.push(`<button data-a="chi:${ch[0]},${ch[1]}">치<small>${ch.map((x) => L.tileName(x)).join(' ')}</small></button>`));
    btns.push(btn('pass', '패스'));
    msg = `${esc(v.names[v.last.p])}가 ${v.last.chankan ? '깡하려는 ' : ''}${L.tileName(t)} 을(를) ${v.last.chankan ? '' : '버렸어요'}${secs}`;
  } else if (v.phase === 'end' || v.phase === 'over') msg = '';
  else if (v.phase === 'claim' && online && v.waiting.length) msg = `${v.waiting.map((p) => esc(v.names[p])).join(', ')}의 선택을 기다리는 중…${secs}`;
  else {
    const n = v.mine.reduce((a, b) => a + b, 0);
    const ok = n === 13 - 3 * v.melds[ME].length && v.waits.length && !(v.phase === 'act' && v.turn === ME);
    msg = ok ? `대기: ${v.waits.map((x) => L.tileName(x)).join(' ')}${v.furiten ? ' · 후리텐(론 불가)' : ''}` : v.phase === 'act' ? `${esc(v.names[v.turn])}의 차례…` : '…';
  }
  if (online && netDown) msg = '연결이 끊겼어요… 다시 연결하는 중';
  $('msg').innerHTML = msg;
  box.innerHTML = btns.join('');
}

// ---------- 소리 ----------
function playEvent(e, mine) {
  if (e.type === 'discard') sfx.discard(); else if (e.type === 'call') sfx.call(); else if (e.type === 'riichi') sfx.riichi();
  else if (e.type === 'dora') sfx.dora();
}
function processLocalEvents() {
  const ev = G.events;
  for (; evIdx < ev.length; evIdx++) {
    const e = ev[evIdx];
    if (e.type === 'end') { const r = e.result; if (r.type === 'win') (r.winners.includes(0) ? sfx.win : sfx.lose)(); else sfx.draw(); } else playEvent(e);
  }
}

// ---------- 혼자 하기: 진행 ----------
const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
function run() {
  if (online || state !== 'play' || !G) return;
  const st = G;
  if (st.phase === 'act') {
    if (st.turn !== 0) { L.aiStep(st, 0); render(); schedule(560); return; }
    if (tut && tutStage === 1 && !tutRigged) {                  // 튜토리얼: 두 번째로 뽑는 패는 이기는 패
      tutRigged = true;
      if (st.drawn != null) { st.hands[0][st.drawn]--; st.hands[0][13]++; st.drawn = 13; }
    }
    sel = null; render();
    const o = L.actOptions(st);
    if (st.riichi[0] && !o.tsumo) timer = setTimeout(() => { if (state === 'play' && G.phase === 'act' && G.turn === 0 && G.riichi[0]) doDiscard(G.drawn, false); }, 700);
    return;
  }
  if (st.phase === 'claim') {
    if (st.claims[0]) { render(); return; }
    L.settleClaims(st, 0, null); render(); schedule(300); return;
  }
  if (st.phase === 'end') { render(); setTimeout(showResult, 500); return; }
  if (st.phase === 'over') { render(); showFinal(); }
}

// ---------- 입력 (혼자/온라인 공통 진입점) ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const sess = loadSession();
      if (sess) this.raw('resume', sess);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online && !loadSession()) return;
      if (room || loadSession()) { netDown = true; render(); setTimeout(() => this.connect(), Math.min(4000, 500 * 2 ** this.retry++)); }
      else showOnlineMenu('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.raw(t, p); else { this.outbox.push([t, p]); this.connect(); } },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() { const ws = this.ws; this.ws = null; this.outbox = []; clearInterval(this.pulse); if (ws) ws.close(); },
};

function doDiscard(t, riichi) {
  if (online) { net.raw('act', { type: 'discard', tile: t, riichi: !!riichi }); sel = null; riichiMode = false; return; }
  if (state !== 'play' || G.phase !== 'act' || G.turn !== 0) return;
  if (tut && tutStage === 0 && t !== TUT_JUNK) { $('msg').textContent = '이번에는 빛나는 「중」 패를 버려 보세요'; sfx.bad(); return; }
  try { L.discard(G, t, riichi); } catch (e) { sfx.bad(); $('msg').textContent = '그 패는 버릴 수 없어요'; return; }
  tutorialSignal('discard'); if (riichi) tutorialSignal('riichi');
  if (tut && tutStage === 0) tutStage = 1;
  sel = null; riichiMode = false; render(); schedule(450);
}
function onTileTap(t) {
  const v = viewOf();
  if (!v || (!online && state !== 'play') || v.phase !== 'act' || v.turn !== ME || !v.opts) return;
  const allowed = riichiMode ? v.opts.riichi : v.opts.discard;
  if (!allowed.includes(t)) { sfx.bad(); $('msg').textContent = riichiMode ? '그 패를 버리면 텐파이가 안 돼요' : '그 패는 지금 버릴 수 없어요'; return; }
  if (sel === t) { doDiscard(t, riichiMode); return; }
  sel = t; sfx.click(); tutorialSignal('select'); render();
}
function onAct(a) {
  const v = viewOf();
  if (!v) return;
  if (v.phase === 'act' && v.turn === ME && v.opts) {
    if (a === 'tsumo') { if (online) { net.raw('act', { type: 'tsumo' }); return; } try { L.tsumo(G); } catch (_) { return; } tutorialSignal('win'); render(); run(); return; }
    if (a === 'riichi') { riichiMode = true; sel = null; render(); return; }
    if (a === 'riichiOff') { riichiMode = false; render(); return; }
    if (a === 'discard') { if (sel == null) { $('msg').textContent = '먼저 버릴 패를 눌러 고르세요'; sfx.bad(); return; } doDiscard(sel, riichiMode); return; }
    if (a.startsWith('kan:')) {
      const t = Number(a.slice(4));
      if (online) { net.raw('act', { type: 'kan', tile: t }); sel = null; return; }
      try { L.kan(G, t); } catch (_) { return; } tutorialSignal('call'); sel = null; render(); run();
    }
    return;
  }
  if (v.phase === 'claim' && v.claim) {
    let choice = 'pass';
    if (a === 'ron' || a === 'pon' || a === 'kan') choice = a; else if (a.startsWith('chi:')) choice = { chi: a.slice(4).split(',').map(Number) };
    if (choice !== 'pass') tutorialSignal(a === 'ron' ? 'win' : 'call');
    if (online) { if (claimSent) return; claimSent = true; net.raw('claim', typeof choice === 'string' ? { choice } : { chi: choice.chi }); render(); return; }
    L.settleClaims(G, 0, choice); sel = null; render(); schedule(300);
  }
}
$('hand').addEventListener('pointerdown', (e) => { const el = e.target.closest('.t'); if (!el || el.dataset.t == null) return; e.preventDefault(); onTileTap(Number(el.dataset.t)); });
$('acts').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) onAct(b.dataset.a); });

// ---------- 화면 겹치기 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelectorAll('button').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level, b.dataset.act); }); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>컴퓨터가 서툼</small></button><button data-level="normal">보통<small>기록 저장</small></button></div>`;
function showTitle() {
  state = 'title'; online = false; room = null; ME = 0;
  showOverlay(`<h1>마작</h1><p>컴퓨터 세 명과 하는 <b>일본식 리치 마작</b><br>동풍전 · 4묶음 + 머리를 만들어 이기세요</p>
    <p class="help">리치 · 퐁 · 치 · 깡 · 론 · 쯔모 · 도라 · 부수 계산<br>친구와는 방 코드로 온라인 대전도 해요</p>
    ${wins ? `<div class="big">1등 ${wins}번</div>` : ''}${lvButtons()}
    ${/[?&]tutorial=1/.test(location.search) ? '' : `<div class="lv"><button class="sub" data-act="online" style="background:rgba(255,255,255,.12);color:#fff;box-shadow:none;border:2px solid rgba(255,255,255,.3)">🌐 온라인 대전<small>친구와 방 코드로 · 빠른 대전</small></button></div>`}
    <p class="note">패를 한 번 누르면 고르고, 한 번 더 누르면 버려요</p>`);
}
function showOnlineMenu(msg = '') {
  state = 'title';
  showOverlay(`<h2>🌐 온라인 대전</h2><p class="note">최대 4명이 함께해요. 모자란 자리는 컴퓨터가 채워요</p>
    <input id="nameInput" maxlength="8" placeholder="이름 (8자까지)" value="${esc(store.get('mahjongName') || '')}" style="padding:9px;border-radius:10px;border:2px solid #4aa878;background:#08241a;color:#fff;font-size:15px;text-align:center;width:200px">
    ${msg ? `<p style="color:#ffb0b0;font-size:13px">${esc(msg)}</p>` : ''}
    <div class="lv"><button data-act="quick">빠른 대전<small>2명이 모이면 바로</small></button><button data-act="create">방 만들기<small>코드로 친구 초대</small></button></div>
    <div class="lv"><input id="codeInput" maxlength="4" placeholder="방 코드" style="padding:9px;border-radius:10px;border:2px solid #4aa878;background:#08241a;color:#fff;font-size:16px;text-align:center;width:100px;text-transform:uppercase"><button class="sub" data-act="join" style="background:rgba(255,255,255,.12);color:#fff;box-shadow:none;border:2px solid rgba(255,255,255,.3)">입장</button></div>
    <div class="lv"><button data-act="back" style="background:rgba(255,255,255,.12);color:#fff;box-shadow:none;border:2px solid rgba(255,255,255,.3)">← 돌아가기</button></div>`);
}
function showQueued() { showOverlay(`<h2>상대를 찾는 중…</h2><p class="note">한 명이 더 오면 바로 시작해요</p><div class="lv"><button data-act="cancel">취소</button></div>`); }
function showWaiting(r) {
  const list = r.players.map((p, i) => `<div style="font-size:15px">${i === 0 ? '👑 ' : ''}${esc(p.name)}${p.online ? '' : ' · 끊김'}</div>`).join('');
  showOverlay(`<h2>대기실</h2><p>친구에게 이 코드를 알려 주세요</p><div style="font-size:40px;font-weight:900;letter-spacing:.15em;color:#ffd23a">${esc(r.code)}</div>${list}
    <p class="note">${r.players.length}명 · 모자란 자리는 컴퓨터가 채워요 (자리는 무작위)</p>
    <div class="lv">${r.host ? `<button data-act="start" ${r.players.length < 2 ? 'disabled' : ''}>시작하기${r.players.length < 2 ? '<small>2명 이상 필요</small>' : ''}</button>` : '<p class="note">방장이 시작하길 기다려요</p>'}<button data-act="leave" style="background:rgba(255,255,255,.12);color:#fff;box-shadow:none;border:2px solid rgba(255,255,255,.3)">나가기</button></div>`);
}
function onOverlayButton(lv, act) {
  const nameEl = $('nameInput');
  if (nameEl) store.set('mahjongName', nameEl.value.trim().slice(0, 8));
  if (act === 'resume') { resume(); return; }
  if (act === 'next') { if (online) { net.raw('next'); } else { hideOverlay(); L.nextHand(G); sel = null; riichiMode = false; render(); if (G.over) { run(); return; } schedule(500); } return; }
  if (act === 'title') { showTitle(); return; }
  if (act === 'online') { showOnlineMenu(); return; }
  if (act === 'back') { showTitle(); return; }
  if (act === 'quick' || act === 'create') { net.send('hello', { name: myName() }); net.send(act); return; }
  if (act === 'join') { const code = ($('codeInput').value || '').trim().toUpperCase(); if (code.length !== 4) { showOnlineMenu('방 코드 4글자를 적어 주세요.'); return; } net.send('hello', { name: myName() }); net.send('join', { code }); return; }
  if (act === 'start') { net.send('start'); return; }
  if (act === 'cancel') { net.send('cancel'); net.close(); showOnlineMenu(); return; }
  if (act === 'leave') { leaveOnline(); return; }
  if (act === 'rematch') { net.send('rematch'); return; }
  start(lv);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'normal' ? 'normal' : 'easy';
  online = false; ME = 0; room = null;
  G = L.newGame(Math.random, { level });
  evIdx = 0; sel = null; riichiMode = false; finalDone = false; tutStage = 0; tutRigged = false;
  if (tut) {                                       // 튜토리얼: 이미 텐파이에 가까운 손에서 시작
    const c = L.counts();
    [1, 2, 3, 4, 5, 6, 11, 12, 13, 23, 24, 25, 13].forEach((x) => { c[x]++; });   // 2·3·4만 5·6·7만 3·4·5통 6·7·8삭 + 5통
    c[TUT_JUNK]++;
    G.hands[0] = c; G.drawn = TUT_JUNK; G.dealer = 0;
  }
  state = 'play'; hideOverlay(); render(); run();
}
function leaveOnline() { net.raw('leave'); net.close(); saveSession(null); showTitle(); }

// ---------- 결과 화면 ----------
function revealRow(r, p) {
  const rv = r.reveal && r.reveal[p];
  if (!rv) return '';
  const closed = handTiles(rv.hand, null);
  return `<div class="hl">${closed.map((t) => tileHTML(t, 'sm')).join('')}<span class="gap"></span>${rv.melds.map((m) => meldHTML(m, 'sm')).join('')}</div>`;
}
const deltaRows = (v, d) => `<table>${[0, 1, 2, 3].map((p) => `<tr><td>${p === ME ? '👉 ' : ''}${esc(v.names[p])}</td><td class="n">${v.scores[p].toLocaleString()}</td><td class="n ${d[p] > 0 ? 'plus' : d[p] < 0 ? 'minus' : ''}">${d[p] > 0 ? '+' : ''}${d[p] || ''}</td></tr>`).join('')}</table>`;
function showResult() {
  const v = viewOf();
  if (!v || !v.result || v.phase !== 'end') return;
  if (!online && state !== 'play') return;
  const r = v.result;
  let html;
  if (r.type === 'win') {
    html = r.wins.map((w) => {
      const who = w.winner === ME ? '내가' : `${esc(v.names[w.winner])}가`;
      return `<h2>${r.tsumo ? '쯔모' : '론'}! ${who} 이겼어요</h2>${revealRow(r, w.winner)}
      <div class="yk">${w.yaku.map((y) => `<span>${y[0]} ${w.yakuman ? '(역만)' : `${y[1]}판`}</span>`).join('')}${w.dora ? `<span>도라 ${w.dora}판</span>` : ''}${w.ura ? `<span>뒷도라 ${w.ura}판</span>` : ''}</div>
      <div class="big">${w.yakuman ? (w.yakuman > 1 ? `${w.yakuman}배 역만` : '역만') : `${w.han}판 ${w.fu}부`} · ${w.pts.toLocaleString()}점</div>`;
    }).join('') + (r.tsumo ? '' : `<p>${esc(v.names[r.from])}가 낸 패로 이김</p>`) + deltaRows(v, r.deltas);
  } else {
    const t = r.tenpai.map((x, p) => (x ? esc(v.names[p]) : null)).filter(Boolean);
    html = `<h2>유국 (패가 바닥났어요)</h2><p>텐파이: ${t.length ? t.join(', ') : '아무도 없음'}</p>${r.tenpai.map((x, p) => (x ? revealRow(r, p) : '')).join('')}${deltaRows(v, r.deltas)}`;
  }
  const last = v.hand >= 3 && (r.type === 'win' ? !r.winners.includes(v.dealer) : !r.tenpai[v.dealer]);
  const ready = online && v.ready.length ? `<p class="note">${v.ready.length}/4 확인</p>` : '';
  showOverlay(`${html}<button data-act="next" ${online && v.ready.includes(ME) ? 'disabled' : ''}>${last ? '결과 보기' : '다음 판'}</button>${ready}`);
}
function showFinal() {
  const v = viewOf();
  if (!v) return;
  const rank = [0, 1, 2, 3].sort((a, b) => v.scores[b] - v.scores[a] || a - b);
  const me = rank.indexOf(ME) + 1;
  if (!online) {
    state = 'over';
    if (!finalDone) { finalDone = true; if (me === 1 && level === 'normal' && !tut) { wins++; store.set('mahjongWins', String(wins)); } }
  }
  const rows = `<table>${rank.map((p, i) => `<tr><td>${i + 1}등</td><td>${p === ME ? '👉 ' : ''}${esc(v.names[p])}</td><td class="n">${v.scores[p].toLocaleString()}</td></tr>`).join('')}</table>`;
  const tail = online ? `<div class="lv"><button data-act="rematch">한 판 더${room && room.rematch.length ? ` (${room.rematch.length}명 기다림)` : ''}</button><button data-act="leave" style="background:rgba(255,255,255,.12);color:#fff;box-shadow:none;border:2px solid rgba(255,255,255,.3)">나가기</button></div>` : `<p>${level === 'normal' ? (me === 1 ? `1등 ${wins}번째!` : `1등 ${wins}번`) : '쉬움에서는 기록이 저장되지 않아요'}</p>${lvButtons()}`;
  showOverlay(`<h2>${me === 1 ? '🏆 1등!' : `${me}등`}</h2>${rows}${tail}`);
}

// ---------- 온라인 ----------
function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; online = false; saveSession(null); state = 'title'; showOnlineMenu(m.msg); }
  else if (m.t === 'resumeFailed') { saveSession(null); netDown = false; if (room) { room = null; online = false; state = 'title'; showOnlineMenu('대국이 끝나서 이어갈 수 없어요.'); } }
}
function applyRoom(r) {
  const fresh = !room || room.code !== r.code || room.games !== r.games;
  room = r; online = true; ME = r.you; netDown = false; recvAt = performance.now();
  saveSession({ code: r.code, token: r.token });
  if (r.state === 'waiting') { state = 'title'; showWaiting(r); return; }
  if (fresh) { state = 'play'; sel = null; riichiMode = false; shownKey = ''; readyKey = ''; finalKey = ''; hideOverlay(); }
  state = 'play';
  const g = r.g;
  if (!g.claim) claimSent = false;
  for (const e of r.events || []) {
    if (e.type === 'end') { /* 결과는 아래에서 */ } else playEvent(e);
    if (e.type === 'start') { sel = null; riichiMode = false; shownKey = ''; hideOverlay(); }
  }
  render();
  if (g.phase === 'end' && r.state === 'playing') {
    const key = `${r.games}:${g.hand}:${g.honba}:${g.scores.join(',')}`;
    if (key !== shownKey) { const w = g.result; if (w && w.type === 'win') (w.winners.includes(ME) ? sfx.win : sfx.lose)(); else sfx.draw(); }
    const full = `${key}:${g.ready.join(',')}`;
    if (full !== readyKey) { readyKey = full; shownKey = key; showResult(); }
  } else if (r.state === 'over') {
    const key = `${r.games}:over:${r.rematch.length}`;
    if (key !== finalKey) { finalKey = key; showFinal(); }
  } else if (shownKey) { shownKey = ''; readyKey = ''; hideOverlay(); }
}
setInterval(() => { if (online && room && room.g && room.g.remain && state === 'play') renderActs(viewOf()); }, 500);

// ---------- 일시정지·소리 ----------
function pause() { if (online || state !== 'play') return; state = 'paused'; clearTimeout(timer); showOverlay(`<h2>일시정지</h2><button data-act="resume">계속하기</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); render(); run(); }
function toggleMute() { muted = !muted; store.set('mahjongMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }

addEventListener('keydown', (e) => { if (e.code === 'KeyP') { state === 'paused' ? resume() : pause(); } else if (e.code === 'KeyM') toggleMute(); });
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
if (loadSession() && !/[?&]tutorial=1/.test(location.search)) { online = true; net.connect(); } else showTitle();
