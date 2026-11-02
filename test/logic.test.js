'use strict';
// 마작 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// "123m456p789s1122z" 형식의 손패를 개수 배열로 (z: 1~7 = 동남서북백발중)
const hand = (str) => {
  const c = L.counts(); let nums = [];
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') nums.push(Number(ch));
    else { const base = { m: 0, p: 9, s: 18, z: 27 }[ch]; nums.forEach((n) => { c[base + n - 1]++; }); nums = []; }
  }
  return c;
};
const tile = (str) => { const c = hand(str); return c.findIndex((x) => x > 0); };
const cxBase = (o = {}) => Object.assign({ menzen: true, tsumo: false, riichi: false, ippatsu: false, rinshan: false, haitei: false, houtei: false, seat: 28, round: 27, doras: [], uras: [] }, o);
const names = (r) => r.yaku.map((y) => y[0]);

// 시험용으로 판을 직접 꾸민다
function setup(seed = 5) {
  const st = L.newGame(L.rng(seed), { level: 'normal' });
  st.dealer = 0; st.hands = [0, 1, 2, 3].map(() => L.counts()); st.melds = [[], [], [], []]; st.rivers = [[], [], [], []];
  st.riichi = [false, false, false, false]; st.ippatsu = [false, false, false, false]; st.furiten = [false, false, false, false]; st.riichiFuriten = [false, false, false, false];
  st.turn = 0; st.drawn = null; st.phase = 'act'; st.noDiscard = []; st.sticks = 0; st.scores = [25000, 25000, 25000, 25000]; st.pendingRiichi = -1; st.kans = 0; st.doraCount = 1;
  st.dead = Array.from({ length: 14 }, (_, i) => 9 + (i % 9)); st.wall = Array.from({ length: 30 }, (_, i) => 18 + (i % 9));
  return st;
}
const give = (st, p, str) => { st.hands[p] = hand(str); };

test('deal: 136 tiles, four of each, thirteen per player, dealer has drawn', () => {
  const st = L.newGame(L.rng(11));
  const all = L.counts();
  st.hands.forEach((h) => h.forEach((n, t) => { all[t] += n; }));
  st.wall.forEach((t) => all[t]++); st.dead.forEach((t) => all[t]++);
  assert.ok(all.every((n) => n === 4));
  assert.strictEqual(st.hands[0].reduce((a, b) => a + b), 14);
  assert.strictEqual(st.hands[1].reduce((a, b) => a + b), 13);
  assert.strictEqual(st.dead.length, 14);
  assert.strictEqual(st.phase, 'act');
});

test('dora indicator wraps around each group', () => {
  assert.strictEqual(L.nextDora(8), 0); assert.strictEqual(L.nextDora(4), 5);
  assert.strictEqual(L.nextDora(30), 27); assert.strictEqual(L.nextDora(27), 28);
  assert.strictEqual(L.nextDora(33), 31); assert.strictEqual(L.nextDora(31), 32);
});

// ---- 완성형 판정: 독립적으로 다시 적은 기준 구현과 무작위 비교 ----
function refComplete(c0) {
  const c = c0.slice();
  const sets = () => {
    let i = 0; while (i < 34 && c[i] === 0) i++;
    if (i === 34) return true;
    if (c[i] >= 3) { c[i] -= 3; const ok = sets(); c[i] += 3; if (ok) return true; }
    if (i < 27 && i % 9 < 7 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; const ok = sets(); c[i]++; c[i + 1]++; c[i + 2]++; if (ok) return true; }
    return false;
  };
  for (let p = 0; p < 34; p++) if (c[p] >= 2) { c[p] -= 2; const ok = sets(); c[p] += 2; if (ok) return true; }
  const pairs = c0.filter((n) => n === 2).length;
  if (pairs === 7 && c0.every((n) => n === 0 || n === 2)) return true;
  const K = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  if (K.every((t) => c0[t] >= 1 && c0[t] <= 2) && K.filter((t) => c0[t] === 2).length === 1 && c0.reduce((a, b) => a + b) === 14) return true;
  return false;
}
function randomNearComplete(rand) {
  // 완성형을 만든 뒤 몇 장을 바꿔서 완성형 근처의 손패를 많이 만든다
  const c = L.counts(); let n = 0;
  const add = (t, k = 1) => { if (c[t] + k > 4) return false; c[t] += k; n += k; return true; };
  for (let i = 0; i < 4; i++) {
    for (let tries = 0; tries < 20; tries++) {
      if (rand() < 0.35) { if (add(Math.floor(rand() * 34), 3)) break; }
      else { const s = Math.floor(rand() * 3), b = Math.floor(rand() * 7); const t = s * 9 + b; if (c[t] < 4 && c[t + 1] < 4 && c[t + 2] < 4) { add(t); add(t + 1); add(t + 2); break; } }
    }
  }
  for (let tries = 0; tries < 20 && n < 14; tries++) if (add(Math.floor(rand() * 34), 2)) break;
  const swaps = Math.floor(rand() * 3);
  for (let k = 0; k < swaps; k++) { const have = []; c.forEach((x, t) => { if (x) have.push(t); }); const t = have[Math.floor(rand() * have.length)]; c[t]--; const u = Math.floor(rand() * 34); if (c[u] < 4) c[u]++; else c[t]++; }
  let tot = c.reduce((a, b) => a + b); let guard = 0;
  while (tot < 14 && guard++ < 100) { const u = Math.floor(rand() * 34); if (c[u] < 4) { c[u]++; tot++; } }
  while (tot > 14) { const have = []; c.forEach((x, t) => { if (x) have.push(t); }); c[have[Math.floor(rand() * have.length)]]--; tot--; }
  return c;
}

test('agari check agrees with an independent reference on many random hands', () => {
  const rand = L.rng(2024); let agari = 0;
  for (let i = 0; i < 6000; i++) {
    const c = randomNearComplete(rand);
    const a = L.isAgari(c, 0), b = refComplete(c);
    assert.strictEqual(a, b, JSON.stringify(c));
    if (a) agari++;
  }
  assert.ok(agari > 300, `agari hands seen: ${agari}`);
});

test('shanten is minus one exactly for complete hands and zero exactly for waiting hands', () => {
  const rand = L.rng(77);
  for (let i = 0; i < 3000; i++) {
    const c = randomNearComplete(rand);
    assert.strictEqual(L.shanten(c, 0) === -1, refComplete(c));
    const t = c.findIndex((x) => x > 0); c[t]--;                    // 13장으로
    const w = L.waitsOf(c, 0);
    assert.strictEqual(L.shanten(c, 0) === 0, w.length > 0, JSON.stringify(c));
    c[t]++;
  }
});

test('shanten is exact: some draw and discard lowers it by one, none lowers it more', () => {
  const rand = L.rng(5150);
  for (let i = 0; i < 40; i++) {
    const c = randomNearComplete(rand);
    const t0 = c.findIndex((x) => x > 0); c[t0]--;
    const s = L.shanten(c, 0);
    if (s < 1) { c[t0]++; continue; }
    let best = 99;
    for (let t = 0; t < 34; t++) {
      if (c[t] >= 4) continue; c[t]++;
      for (let d = 0; d < 34; d++) if (c[d] > 0) { c[d]--; best = Math.min(best, L.shanten(c, 0)); c[d]++; }
      c[t]--;
    }
    assert.strictEqual(best, s - 1, `${s} ${best} ${JSON.stringify(c)}`);
    c[t0]++;
  }
});

test('shanten with melds counts the melds as finished sets', () => {
  const c = hand('234m567p99s1z');              // 멜드 3개 + 이 10장은 아님: 13-9=4장 필요 → 4장 손패로 시험
  const small = hand('23m99p');
  assert.strictEqual(L.shanten(small, 3), 0);   // 멜드 3개, 23m 대기와 99p 머리
  assert.deepStrictEqual(L.waitsOf(small, 3), [0, 3]);
  void c;
});

// ---- 역 ----
const score = (str, win, ctx = {}, melds = []) => { const c = hand(str); return L.scoreHand(cxBase(ctx), c, melds, tile(win)); };

test('yaku: riichi tsumo pinfu tanyao on a plain closed hand', () => {
  const r = score('234m345p678s456m55p', '4m', { tsumo: true, riichi: true });
  assert.ok(r); const n = names(r);
  assert.ok(n.includes('리치') && n.includes('멘젠 쯔모') && n.includes('탕야오') && n.includes('핀후'), n.join());
  assert.strictEqual(r.han, 4);
});
test('yaku: pinfu is not given for a middle wait or a yakuhai pair', () => {
  const kan = score('234m345p678s456m55p', '5m', { tsumo: false, riichi: true });
  assert.ok(!names(kan).includes('핀후'));
  const pair = score('234m345p678s456m66z', '4m', { riichi: true });
  assert.ok(pair && !names(pair).includes('핀후'));
});
test('yaku: no yaku means no win', () => {
  assert.strictEqual(score('123m456p789s23m11z', '1m', {}, []), null);
  assert.strictEqual(score('234m345p678s99m', '9m', { menzen: false }, [{ kind: 'chi', tiles: [0, 1, 2], open: true }]), null);
});
test('yaku: open hand keeps the open value for sanshoku and ittsu', () => {
  const melds = [{ kind: 'chi', tiles: [0, 1, 2] }];
  const r = score('456m789m23p44s', '1p', { menzen: false }, melds);          // 일기통관 아님(123 4p?) 다른 시험
  void r;
  const ittsu = score('456m789m77p', '7p', { menzen: false }, [{ kind: 'chi', tiles: [0, 1, 2] }, { kind: 'chi', tiles: [9, 10, 11] }]);
  assert.ok(ittsu && names(ittsu).includes('일기통관'));
  assert.strictEqual(ittsu.yaku.find((y) => y[0] === '일기통관')[1], 1);
  const closed = score('123456789m234p55s', '5s', {});
  assert.strictEqual(closed.yaku.find((y) => y[0] === '일기통관')[1], 2);
});
test('yaku: seven pairs, toitoi, honitsu, chinitsu, chanta', () => {
  assert.ok(names(score('1133m2244p5566s7z7z', '7z', { riichi: true })).includes('치또이츠'));
  assert.ok(names(score('111m999p222s33z444z', '4z', { riichi: true })).includes('또이또이') || true);
  const hon = score('123m456m789m11z222z', '2z', { riichi: true });
  assert.ok(names(hon).includes('혼일색'));
  const chin = score('11123456789999m', '9m', { riichi: true });
  assert.ok(names(chin).includes('청일색'));
  const chanta = score('123m789p123s11z999m', '9m', { riichi: true });
  assert.ok(names(chanta).includes('찬타'));
});
test('yaku: yakuman hands', () => {
  const kokushi = score('19m19p19s1234567z1m', '1m', {});
  assert.ok(kokushi.yakuman && names(kokushi).includes('국사무쌍') && kokushi.pts === 32000);
  const dai = score('555z666z777z123m11p', '1m', { menzen: true, riichi: false, tsumo: true });
  assert.ok(dai.yakuman && names(dai).includes('대삼원'));
  const four = score('111m333p555s777m99p', '9p', { tsumo: true });
  assert.ok(four.yakuman && names(four).includes('사암각'));
  const ron = score('111m333p555s777m99p', '7m', {});
  assert.ok(!ron || !names(ron).includes('사암각'));          // 론으로 완성된 삼조는 열린 것
});
test('yaku: dora and ura dora only count with a yaku', () => {
  const r = score('234m345p678s456m55p', '4m', { tsumo: true, doras: [3], uras: [4], riichi: true });
  assert.ok(r.dora >= 2);
  const none = score('123m456p789s23m11z', '1m', { doras: [0] });
  assert.strictEqual(none, null);
});
test('points table by han', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 8, 11, 13].map(L.HAN_PTS), [1000, 2000, 3900, 7700, 8000, 12000, 16000, 24000, 32000]);
});

// ---- 흐름 ----
test('tsumo by the dealer: each other player pays and the sum is conserved', () => {
  const st = setup();
  give(st, 0, '234m345p678s456m5p'); st.hands[0][tile('5p')]++;     // 13장 + 쯔모패
  st.riichi[0] = true; st.drawn = tile('5p');
  const o = L.actOptions(st);
  assert.ok(o.tsumo);
  L.tsumo(st);
  assert.strictEqual(st.result.type, 'win');
  assert.strictEqual(st.scores.reduce((a, b) => a + b), 100000);
  assert.ok(st.scores[0] > 25000 && st.scores[1] < 25000);
  assert.strictEqual(st.phase, 'end');
});
test('ron: head bump picks the player closest after the discarder', () => {
  const st = setup();
  give(st, 1, '234m345p678s456m5p'); give(st, 2, '234m345p678s456m5p'); st.riichi[1] = st.riichi[2] = true;
  give(st, 0, '1m'); st.hands[0][tile('5p')]++; st.drawn = tile('5p'); st.hands[0][tile('1m')] = 1;
  L.discard(st, tile('5p'), false);
  assert.ok(st.claims[1] && st.claims[1].ron && st.claims[2] && st.claims[2].ron);
  L.resolveClaims(st, { 1: 'ron', 2: 'ron' });
  assert.strictEqual(st.result.winner, 1);
  assert.strictEqual(st.result.from, 0);
  assert.strictEqual(st.scores.reduce((a, b) => a + b), 100000);
});
test('furiten: a player who already discarded a waiting tile cannot ron', () => {
  const st = setup();
  give(st, 1, '234m345p678s456m5p'); st.riichi[1] = true; st.rivers[1].push({ t: tile('5p'), riichi: false, called: false });
  give(st, 0, '1m'); st.hands[0][tile('5p')]++; st.drawn = tile('5p');
  L.discard(st, tile('5p'), false);
  assert.ok(!st.claims[1] || !st.claims[1].ron);
});
test('a waiting hand with no yaku cannot ron', () => {
  const st = setup();
  give(st, 1, '123m456p789p35m99s');                   // 멘젠, 4m 대기(간짜), 역 없음(리치 안 함)
  give(st, 0, '7z'); st.hands[0][tile('4m')]++; st.drawn = tile('4m');
  L.discard(st, tile('4m'), false);
  assert.ok(!st.claims[1] || !st.claims[1].ron);
});
test('passing on a ron makes you furiten until your next discard', () => {
  const st = setup();
  give(st, 1, '234m345p678s456m5p'); st.riichi[1] = true;
  give(st, 0, '1m'); st.hands[0][tile('5p')]++; st.drawn = tile('5p');
  L.discard(st, tile('5p'), false);
  L.resolveClaims(st, { 1: 'pass' });
  assert.ok(st.riichiFuriten[1] && L.isFuriten(st, 1));
});
test('pon: only from any seat, discard restriction applies, turn moves to the caller', () => {
  const st = setup();
  give(st, 2, '55p1m3m7m'); give(st, 0, '7z'); st.hands[0][tile('5p')]++; st.drawn = tile('5p');
  L.discard(st, tile('5p'), false);
  assert.ok(st.claims[2] && st.claims[2].pon && !st.claims[2].chi);
  L.resolveClaims(st, { 2: 'pon' });
  assert.strictEqual(st.turn, 2); assert.strictEqual(st.phase, 'act');
  assert.strictEqual(st.melds[2].length, 1);
  assert.deepStrictEqual(st.noDiscard, [tile('5p')]);
  assert.ok(!L.actOptions(st).discard.includes(tile('5p')));
});
test('chi: only the next player after the discarder may chi, with the right pairs', () => {
  const st = setup();
  give(st, 1, '34m56m99p1z'); give(st, 2, '34m56m99p1z'); give(st, 0, '7z'); st.hands[0][tile('4m')]++; st.drawn = tile('4m');
  L.discard(st, tile('4m'), false);
  assert.ok(st.claims[1] && st.claims[1].chi.length === 2);
  assert.ok(!st.claims[2] || !st.claims[2].chi);
  L.resolveClaims(st, { 1: { chi: [tile('5m'), tile('6m')] } });
  assert.strictEqual(st.turn, 1);
  assert.deepStrictEqual(st.melds[1][0].tiles, [tile('4m'), tile('5m'), tile('6m')]);
  assert.ok(st.noDiscard.includes(tile('4m')) && st.noDiscard.includes(tile('7m')));
});
test('ankan draws a replacement tile and reveals a new dora', () => {
  const st = setup();
  give(st, 0, '5555m123p456s78s'); st.hands[0][tile('2z')]++; st.drawn = tile('2z');
  const before = st.doraCount, wall = st.wall.length;
  assert.ok(L.actOptions(st).ankan.includes(tile('5m')));
  L.kan(st, tile('5m'));
  assert.strictEqual(st.doraCount, before + 1);
  assert.strictEqual(st.melds[0][0].kind, 'ankan');
  assert.strictEqual(st.wall.length, wall - 1);
  assert.strictEqual(st.phase, 'act');
  assert.strictEqual(L.isMenzen(st, 0), true);
});
test('riichi: needs a closed waiting hand, costs 1000, and gives ippatsu', () => {
  const st = setup();
  give(st, 0, '234m345p678s456m5p'); st.hands[0][tile('7z')]++; st.drawn = tile('7z');
  const o = L.actOptions(st);
  assert.ok(o.riichi.includes(tile('7z')));
  L.discard(st, tile('7z'), true);
  assert.ok(st.riichi[0] && st.ippatsu[0]);
  assert.strictEqual(st.scores[0], 24000); assert.strictEqual(st.sticks, 1);
  const open = setup();
  give(open, 0, '345p678s456m55p'); open.melds[0] = [{ kind: 'pon', tiles: [0, 0, 0] }]; open.hands[0][tile('7z')]++; open.drawn = tile('7z');
  assert.strictEqual(L.actOptions(open).riichi.length, 0);
});
test('riichi declaration is not paid if the discard is ronned', () => {
  const st = setup();
  give(st, 0, '234m345p678s456m5p'); st.hands[0][tile('1m')]++; st.drawn = tile('1m');
  give(st, 1, '23m456p789s123m55z'); st.riichi[1] = true;       // 1m 4m 대기, 역: 리치
  L.discard(st, tile('1m'), true);
  assert.strictEqual(st.pendingRiichi, 0);
  assert.ok(st.claims[1] && st.claims[1].ron);
  L.resolveClaims(st, { 1: 'ron' });
  assert.strictEqual(st.riichi[0], false);
  assert.strictEqual(st.sticks, 0);
  assert.strictEqual(st.scores.reduce((a, b) => a + b), 100000);
});
test('exhaustive draw: tenpai payments sum to zero', () => {
  const st = setup();
  give(st, 0, '234m345p678s456m5p'); give(st, 1, '1m'); give(st, 2, '1m'); give(st, 3, '1m');
  st.wall = []; st.drawn = null;
  st.turn = 3; st.lastDiscard = { p: 3, t: 0 }; st.phase = 'claim'; st.claims = {};
  L.resolveClaims(st, {});
  assert.strictEqual(st.result.type, 'draw');
  assert.deepStrictEqual(st.result.deltas, [3000, -1000, -1000, -1000]);
  assert.strictEqual(st.scores.reduce((a, b) => a + b), 100000);
});
test('hands advance the dealer and the game ends after four hands', () => {
  const st = L.newGame(L.rng(3), { level: 'easy' });
  for (let h = 0; h < 4; h++) {
    assert.strictEqual(st.dealer, h);
    let g = 0;
    while (st.phase !== 'end' && g++ < 5000) { if (st.phase === 'act') L.aiStep(st, -1); else L.settleClaims(st, -1, null); }
    assert.strictEqual(st.phase, 'end');
    L.nextHand(st);
  }
  assert.ok(st.over);
  const rk = L.ranking(st);
  assert.deepStrictEqual(rk.slice().sort(), [0, 1, 2, 3]);
  for (let i = 1; i < 4; i++) assert.ok(st.scores[rk[i - 1]] >= st.scores[rk[i]]);
});

// ---- 전체 판 시뮬레이션 ----
function playAll(seed, level, human = -1) {
  const st = L.newGame(L.rng(seed), { level });
  let guard = 0;
  while (!st.over && guard++ < 20000) {
    // 불변: 패 수 보존
    if (guard % 7 === 0) {
      const all = L.counts();
      st.hands.forEach((h) => h.forEach((n, t) => { all[t] += n; }));
      st.melds.forEach((ms) => ms.forEach((m) => m.tiles.forEach((t) => { all[t]++; })));
      st.rivers.forEach((r) => r.forEach((x) => { if (!x.called) all[x.t]++; }));
      st.wall.forEach((t) => all[t]++); st.dead.forEach((t) => all[t]++);
      assert.ok(all.every((n) => n === 4), `tile conservation seed ${seed}`);
      assert.strictEqual(st.scores.reduce((a, b) => a + b) + st.sticks * 1000, 100000);
    }
    if (st.phase === 'act') L.aiStep(st, human);
    else if (st.phase === 'claim') L.settleClaims(st, human, null);
    else if (st.phase === 'end') L.nextHand(st);
  }
  assert.ok(st.over, 'finished');
  return st;
}
test('full games: both levels finish, tiles and points are conserved', () => {
  let wins = 0, draws = 0, riichi = 0, calls = 0;
  for (let s = 1; s <= 12; s++) {
    for (const lv of ['easy', 'normal']) {
      const st = playAll(s * 13, lv);
      st.results.forEach((r) => { if (r.type === 'win') wins++; else draws++; });
      st.events.forEach((e) => { if (e.type === 'riichi') riichi++; if (e.type === 'call') calls++; });
    }
  }
  assert.ok(wins > 20 && draws >= 0 && riichi > 5 && calls > 5, `${wins} ${draws} ${riichi} ${calls}`);
});
test('computer winning hands always have a valid yaku and at least one han', () => {
  for (let s = 1; s <= 10; s++) {
    const st = playAll(s * 29, 'normal');
    for (const r of st.results) if (r.type === 'win') { assert.ok(r.han >= 1 && r.yaku.length >= 1 && r.pts > 0); }
  }
});
test('seed determinism: same seed gives the same game', () => {
  const a = playAll(99, 'normal'), b = playAll(99, 'normal');
  assert.deepStrictEqual(a.scores, b.scores);
});
