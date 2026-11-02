'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 마작: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_MJ).
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
let sel = null, riichiMode = false, timer = null, evIdx = 0, finalDone = false;
let wins = Number(store.get('mahjongWins')) || 0;
const TUT_JUNK = 33;                               // 튜토리얼 첫 버릴 패: 중

/* @test-hooks:start */
window.__mj = { get G() { return G; }, get state() { return state; }, L, run: () => run(), set(g) { G = g; }, get sel() { return sel; } };
/* @test-hooks:end */

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

function render() {
  if (!G) return;
  const st = G;
  processEvents();
  const me = 0, myTurn = st.phase === 'act' && st.turn === me;
  $('info').textContent = `동${Math.min(4, st.hand + 1)}국 · 내 자리 ${WIND[(me - st.dealer + 4) % 4]} · 남은 패 ${st.wall.length}`;
  const ind = L.doraIndicators(st);
  $('dora').innerHTML = `<small>도라</small>` + [0, 1, 2, 3, 4].map((i) => (i < ind.length ? tileHTML(ind[i], 'xs') : backHTML('xs'))).join('');
  // 강
  const panel = (p, cls) => {
    const seat = WIND[(p - st.dealer + 4) % 4];
    const turn = st.phase !== 'end' && st.phase !== 'over' && (st.phase === 'act' ? st.turn === p : st.lastDiscard && st.lastDiscard.p === p);
    return `<div class="pn ${cls} ${turn ? 'turn' : ''}"><div class="hd"><span>${esc(st.names[p])} · ${seat}${p === st.dealer ? ' (친)' : ''} ${st.riichi[p] ? '<span class="rc">리치</span>' : ''}</span><span class="sc">${st.scores[p].toLocaleString()}</span></div>
      <div class="river">${st.rivers[p].map((r) => tileHTML(r.t, `sm ${r.riichi ? 'rt' : ''} ${r.called ? 'called' : ''}`)).join('')}</div>
      ${st.melds[p].length ? `<div class="melds">${st.melds[p].map((m) => meldHTML(m, 'xs')).join('')}</div>` : ''}</div>`;
  };
  $('table').innerHTML = panel(2, 'top') + panel(3, '') + panel(1, '') + panel(0, 'top');
  // 내 손
  const c = st.hands[me], drawn = myTurn ? st.drawn : null;
  const o = myTurn ? L.actOptions(st) : null;
  const allowed = o ? (riichiMode ? o.riichi : o.discard) : [];
  const tileCls = (t) => `${sel === t ? 'sel' : ''} ${myTurn && !allowed.includes(t) ? 'dis' : ''} ${tut && tutStage === 0 && t === TUT_JUNK ? 'hint' : ''}`;
  const tiles = handTiles(c, drawn);
  let html = tiles.map((t) => tileHTML(t, tileCls(t))).join('');
  if (drawn != null) html += `<span class="gap"></span>` + tileHTML(drawn, tileCls(drawn));
  $('hand').innerHTML = html;
  $('myMelds').innerHTML = st.melds[me].map((m) => meldHTML(m, '')).join('');
  renderActs(o);
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}

function renderActs(o) {
  const st = G, box = $('acts');
  let msg = '', btns = [];
  const btn = (a, label, cls = '', small = '') => `<button data-a="${a}" class="${cls}">${label}${small ? `<small>${small}</small>` : ''}</button>`;
  if (st.phase === 'act' && st.turn === 0) {
    if (o.tsumo) btns.push(btn('tsumo', '쯔모', 'go', `${o.tsumo.han}판`));
    if (o.riichi.length) btns.push(riichiMode ? btn('riichiOff', '리치 취소', 'on') : btn('riichi', '리치', 'warn'));
    o.ankan.forEach((t) => btns.push(btn(`kan:${t}`, '깡', '', L.tileName(t))));
    o.shouminkan.forEach((t) => btns.push(btn(`kan:${t}`, '깡', '', L.tileName(t))));
    btns.push(btn('discard', '버리기', 'go'));
    msg = riichiMode ? '리치할 패를 고르세요 (밝은 패만 가능). 한 번 더 누르면 리치!' : st.riichi[0] ? '리치 중: 쯔모할 수 있으면 쯔모, 아니면 뽑은 패가 자동으로 버려져요' : st.drawn == null ? '불러온 뒤에는 패를 한 장 버려야 해요' : '버릴 패를 누르세요 (한 번 더 누르거나 [버리기])';
  } else if (st.phase === 'claim' && st.claims[0]) {
    const cl = st.claims[0], t = st.lastDiscard.t;
    if (cl.ron) btns.push(btn('ron', '론!', 'go', '이겼어요'));
    if (cl.kan) btns.push(btn('kan', '깡'));
    if (cl.pon) btns.push(btn('pon', '퐁'));
    if (cl.chi) cl.chi.forEach((ch) => btns.push(`<button data-a="chi:${ch[0]},${ch[1]}">치${'<small>'}${ch.map((x) => L.tileName(x)).join(' ')}${'</small>'}</button>`));
    btns.push(btn('pass', '패스'));
    msg = `${esc(st.names[st.lastDiscard.p])}가 ${L.tileName(t)} 을(를) 버렸어요`;
  } else if (st.phase === 'end' || st.phase === 'over') msg = '';
  else {
    const w = st.phase === 'act' && st.turn === 0 ? [] : L.waitsNow(st, 0);
    const t = st.phase === 'act' ? st.names[st.turn] : '';
    msg = w.length && st.hands[0].reduce((a, b) => a + b) === 13 - 3 * st.melds[0].length ? `대기: ${w.map((x) => L.tileName(x)).join(' ')}${L.isFuriten(st, 0) ? ' · 후리텐(론 불가)' : ''}` : st.phase === 'act' ? `${esc(t)}의 차례…` : '…';
  }
  $('msg').innerHTML = msg;
  box.innerHTML = btns.join('');
}

// ---------- 이벤트 소리 ----------
function processEvents() {
  const ev = G.events;
  for (; evIdx < ev.length; evIdx++) {
    const e = ev[evIdx];
    if (e.type === 'discard') sfx.discard(); else if (e.type === 'call') sfx.call(); else if (e.type === 'riichi') sfx.riichi();
    else if (e.type === 'dora') sfx.dora();
    else if (e.type === 'end') { const r = e.result; if (r.type === 'win') (r.winner === 0 ? sfx.win : sfx.lose)(); else sfx.draw(); }
  }
}

// ---------- 진행 ----------
const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
function run() {
  if (state !== 'play' || !G) return;
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
function doDiscard(t, riichi) {
  if (state !== 'play' || G.phase !== 'act' || G.turn !== 0) return;
  if (tut && tutStage === 0 && t !== TUT_JUNK) { $('msg').textContent = '이번에는 빛나는 「중」 패를 버려 보세요'; sfx.bad(); return; }
  try { L.discard(G, t, riichi); } catch (e) { sfx.bad(); $('msg').textContent = '그 패는 버릴 수 없어요'; return; }
  tutorialSignal('discard'); if (riichi) tutorialSignal('riichi');
  if (tut && tutStage === 0) tutStage = 1;
  sel = null; riichiMode = false; render(); schedule(450);
}
function onTileTap(t) {
  if (state !== 'play' || G.phase !== 'act' || G.turn !== 0) return;
  const o = L.actOptions(G), allowed = riichiMode ? o.riichi : o.discard;
  if (!allowed.includes(t)) { sfx.bad(); $('msg').textContent = G.noDiscardMsg || (riichiMode ? '그 패를 버리면 텐파이가 안 돼요' : '그 패는 지금 버릴 수 없어요'); return; }
  if (sel === t) { doDiscard(t, riichiMode); return; }
  sel = t; sfx.click(); tutorialSignal('select'); render();
}
function onAct(a) {
  if (state !== 'play') return;
  if (G.phase === 'act' && G.turn === 0) {
    if (a === 'tsumo') { try { L.tsumo(G); } catch (_) { return; } tutorialSignal('win'); render(); run(); return; }
    if (a === 'riichi') { riichiMode = true; sel = null; render(); return; }
    if (a === 'riichiOff') { riichiMode = false; render(); return; }
    if (a === 'discard') { if (sel == null) { $('msg').textContent = '먼저 버릴 패를 눌러 고르세요'; sfx.bad(); return; } doDiscard(sel, riichiMode); return; }
    if (a.startsWith('kan:')) { try { L.kan(G, Number(a.slice(4))); } catch (_) { return; } tutorialSignal('call'); sel = null; render(); run(); }
    return;
  }
  if (G.phase === 'claim' && G.claims[0]) {
    let choice = 'pass';
    if (a === 'ron' || a === 'pon' || a === 'kan') choice = a; else if (a.startsWith('chi:')) choice = { chi: a.slice(4).split(',').map(Number) };
    if (choice !== 'pass') tutorialSignal(a === 'ron' ? 'win' : 'call');
    L.settleClaims(G, 0, choice); sel = null; render(); schedule(300);
  }
}
$('hand').addEventListener('pointerdown', (e) => { const el = e.target.closest('.t'); if (!el || el.dataset.t == null) return; e.preventDefault(); onTileTap(Number(el.dataset.t)); });
$('acts').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) onAct(b.dataset.a); });

// ---------- 시작·끝 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelectorAll('button').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level, b.dataset.act); }); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>컴퓨터가 서툼</small></button><button data-level="normal">보통<small>기록 저장</small></button></div>`;
function onOverlayButton(lv, act) {
  if (act === 'resume') { resume(); return; }
  if (act === 'next') { hideOverlay(); L.nextHand(G); sel = null; riichiMode = false; render(); if (G.over) { run(); return; } schedule(500); return; }
  if (act === 'title') { showTitle(); return; }
  start(lv);
}
function showTitle() {
  state = 'title';
  showOverlay(`<h1>마작</h1><p>컴퓨터 세 명과 하는 <b>일본식 리치 마작</b><br>동풍전 4판 · 4묶음 + 머리를 만들어 이기세요</p>
    <p class="help">리치 · 퐁 · 치 · 깡 · 론 · 쯔모 · 도라<br>부수 계산은 없는 간단한 점수예요</p>
    ${wins ? `<div class="big">1등 ${wins}번</div>` : ''}${lvButtons()}<p class="note">패를 한 번 누르면 고르고, 한 번 더 누르면 버려요</p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'normal' ? 'normal' : 'easy';
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
function resultTiles(p, r) {
  const st = G, c = st.hands[p].slice();
  if (r.type === 'win' && !r.tsumo && r.winner === p) c[r.tile]++;
  const closed = handTiles(c, r.type === 'win' && r.tsumo && r.winner === p ? r.tile : null);
  return `<div class="hl">${closed.map((t) => tileHTML(t, 'sm')).join('')}${r.type === 'win' && r.tsumo && r.winner === p ? `<span class="gap"></span>${tileHTML(r.tile, 'sm')}` : ''}<span class="gap"></span>${st.melds[p].map((m) => meldHTML(m, 'sm')).join('')}</div>`;
}
const deltaRows = (st, d) => `<table>${[0, 1, 2, 3].map((p) => `<tr><td>${esc(st.names[p])}</td><td class="n">${st.scores[p].toLocaleString()}</td><td class="n ${d[p] > 0 ? 'plus' : d[p] < 0 ? 'minus' : ''}">${d[p] > 0 ? '+' : ''}${d[p] || ''}</td></tr>`).join('')}</table>`;
function showResult() {
  if (state !== 'play' || !G || G.phase !== 'end') return;
  const st = G, r = st.result;
  let html;
  if (r.type === 'win') {
    const who = r.winner === 0 ? '내가' : `${esc(st.names[r.winner])}가`;
    html = `<h2>${r.tsumo ? '쯔모' : '론'}! ${who} 이겼어요</h2>${resultTiles(r.winner, r)}
      <div class="yk">${r.yaku.map((y) => `<span>${y[0]} ${r.yakuman ? '(역만)' : `${y[1]}판`}</span>`).join('')}${r.dora ? `<span>도라 ${r.dora}판</span>` : ''}${r.ura ? `<span>뒷도라 ${r.ura}판</span>` : ''}</div>
      <div class="big">${r.yakuman ? '역만' : `${r.han}판`} · ${r.pts.toLocaleString()}점</div>${r.tsumo ? '' : `<p>${esc(st.names[r.from])}가 낸 패로 이김</p>`}${deltaRows(st, r.deltas)}`;
  } else {
    const t = r.tenpai.map((x, p) => (x ? esc(st.names[p]) : null)).filter(Boolean);
    html = `<h2>유국 (패가 바닥났어요)</h2><p>텐파이: ${t.length ? t.join(', ') : '아무도 없음'}</p>${deltaRows(st, r.deltas)}`;
  }
  const last = st.hand >= 3 || st.scores.some((s) => s < 0);
  showOverlay(`${html}<button data-act="next">${last ? '결과 보기' : '다음 판'}</button>`);
}
function showFinal() {
  state = 'over';
  const st = G, rank = L.ranking(st);
  const me = rank.indexOf(0) + 1;
  if (!finalDone) { finalDone = true; if (me === 1 && level === 'normal' && !tut) { wins++; store.set('mahjongWins', String(wins)); } }
  showOverlay(`<h2>${me === 1 ? '🏆 1등!' : `${me}등`}</h2><table>${rank.map((p, i) => `<tr><td>${i + 1}등</td><td>${esc(st.names[p])}</td><td class="n">${st.scores[p].toLocaleString()}</td></tr>`).join('')}</table>
    <p>${level === 'normal' ? (me === 1 ? `1등 ${wins}번째!` : `1등 ${wins}번`) : '쉬움에서는 기록이 저장되지 않아요'}</p>${lvButtons()}`);
}
function pause() { if (state !== 'play') return; state = 'paused'; clearTimeout(timer); showOverlay(`<h2>일시정지</h2><button data-act="resume">계속하기</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); render(); run(); }
function toggleMute() { muted = !muted; store.set('mahjongMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }

addEventListener('keydown', (e) => { if (e.code === 'KeyP') { state === 'paused' ? resume() : pause(); } else if (e.code === 'KeyM') toggleMute(); });
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
showTitle();
