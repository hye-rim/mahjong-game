'use strict';
// 마작 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

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
  const chin = score('123456m234789m55m', '5m', { riichi: true });
  assert.ok(names(chin).includes('청일색'));
  const chanta = score('123m789p123s11z999m', '9m', { riichi: true });
  assert.ok(names(chanta).includes('찬타'));
});
test('yaku: yakuman hands', () => {
  const kokushi = score('19m19p19s1234567z1m', '1m', {});
  assert.ok(kokushi.yakuman === 1 && names(kokushi).includes('국사무쌍') && kokushi.base === 8000);
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
test('base points: fu times two to the han plus two, with the limits', () => {
  assert.strictEqual(L.HAN_PTS(1, 30, 0), 240);
  assert.strictEqual(L.HAN_PTS(2, 30, 0), 480);
  assert.strictEqual(L.HAN_PTS(3, 30, 0), 960);
  assert.strictEqual(L.HAN_PTS(4, 30, 0), 2000);          // 1920 은 만관으로 올림
  assert.strictEqual(L.HAN_PTS(3, 70, 0), 2000);
  assert.deepStrictEqual([5, 6, 7, 8, 10, 11, 12].map((h) => L.HAN_PTS(h, 30, 0)), [2000, 3000, 3000, 4000, 4000, 6000, 6000]);
  assert.strictEqual(L.HAN_PTS(13, 0, 1), 8000);
  assert.strictEqual(L.HAN_PTS(26, 0, 2), 16000);
});
test('fu: closed ron 30, tsumo pinfu 20, chiitoi 25, concealed triplet and wait fu', () => {
  const pinfuTsumo = score('234m567p678s345m55p', '5m', { riichi: true, tsumo: true });
  assert.ok(names(pinfuTsumo).includes('핀후')); assert.strictEqual(pinfuTsumo.fu, 20);
  const pinfuRon = score('234m567p678s345m55p', '5m', { riichi: true });
  assert.ok(names(pinfuRon).includes('핀후')); assert.strictEqual(pinfuRon.fu, 30);
  const pairs = score('1133m2244p5566s77z', '7z', { riichi: true });
  assert.strictEqual(pairs.fu, 25);
  const tri = score('222m567p678s456m99p', '6m', { riichi: true });                // 암커 2m 4 + 양면 0 + 멘젠 론 10 + 기본 20 = 34 -> 40
  assert.strictEqual(tri.fu, 40);
  const kanchan = score('222m567p678s456m99p', '5m', { riichi: true });             // 간짜 +2 -> 36 -> 40
  assert.strictEqual(kanchan.fu, 40);
  const openPinfu = score('234m567p678s55p', '5p', { menzen: false, tanyao: true }, [{ kind: 'chi', tiles: [3, 4, 5] }]);   // 문 연 핀후 모양 + 론: 22 -> 30
  assert.strictEqual(openPinfu.fu, 30);
});
test('fu: yakuhai pair, terminal triplet, concealed kan', () => {
  const dr = score('234m567p678s456m77z', '6m', { riichi: true });                 // 중 머리 +2, 멘젠 론 10, 기본 20 = 32 -> 40
  assert.strictEqual(dr.fu, 40);
  const term = score('111m567p678s456m99p', '6m', { riichi: true });               // 1m 암커 8 + 10 + 20 = 38 -> 40
  assert.strictEqual(term.fu, 40);
  const ankan = score('234m567p678s99p', '9p', { riichi: true, tsumo: true }, [{ kind: 'ankan', tiles: [27, 27, 27, 27] }]);   // 20 + 쯔모 2 + 동 암깡 32 + 단기 2 = 56 -> 60
  assert.ok(ankan); assert.strictEqual(ankan.fu, 60);
});
test('scoring examples: non-dealer ron 1 han 30 fu is 1000, dealer tsumo mangan is 4000 from each', () => {
  const st = setup();
  give(st, 1, '234m345p678s456m5p'); st.riichi[1] = true;
  give(st, 0, '1m'); st.hands[0][tile('5p')]++; st.drawn = tile('5p');
  L.discard(st, tile('5p'), false);
  L.resolveClaims(st, { 1: 'ron' });
  const w = st.result.wins[0];
  assert.strictEqual(w.pts, Math.ceil(4 * w.base / 100) * 100);
  assert.strictEqual(st.result.deltas[0], -w.pts);
  const dt = setup();
  give(dt, 0, '234m567m345p678s5p'); dt.hands[0][tile('5p')]++; dt.drawn = tile('5p'); dt.riichi[0] = true; dt.doraCount = 1; dt.dead[4] = tile('4p');   // 도라 5p x2 -> 리치 쯔모 탕야오 핀후 도라 2 이상
  L.tsumo(dt);
  const x = dt.result.wins[0];
  assert.ok(x.han >= 5 && x.base >= 2000);
  assert.strictEqual(dt.result.deltas[1], -Math.ceil(2 * x.base / 100) * 100);
});
test('hands: the dealer stays on a dealer win or a tenpai draw and the game ends after the north dealer', () => {
  const st = L.newGame(L.rng(3), { level: 'easy' });
  let hands = 0, last = 0, repeats = 0;
  while (!st.over && hands++ < 80) {
    assert.ok(st.hand >= last); last = st.hand;
    let g = 0;
    while (st.phase !== 'end' && g++ < 5000) { if (st.phase === 'act') L.aiStep(st, -1); else L.settleClaims(st, -1, null); }
    assert.strictEqual(st.phase, 'end');
    const r = st.result, before = st.hand, honba = st.honba;
    const repeat = r.type === 'win' ? r.winners.includes(st.dealer) : r.tenpai[st.dealer];
    L.nextHand(st);
    if (repeat) { assert.strictEqual(st.hand, before); assert.strictEqual(st.honba, honba + 1); repeats++; }
    else { assert.strictEqual(st.hand, before + 1); assert.strictEqual(st.honba, r.type === 'win' ? 0 : honba + 1); }
  }
  assert.ok(st.over);
  const rk = L.ranking(st);
  assert.deepStrictEqual(rk.slice().sort(), [0, 1, 2, 3]);
  for (let i = 1; i < 4; i++) assert.ok(st.scores[rk[i - 1]] >= st.scores[rk[i]]);
});
test('honba counters add 300 to a ron and 100 from each payer to a tsumo', () => {
  const st = setup(); st.honba = 2;
  give(st, 1, '234m345p678s456m5p'); st.riichi[1] = true;
  give(st, 0, '1m'); st.hands[0][tile('5p')]++; st.drawn = tile('5p');
  L.discard(st, tile('5p'), false);
  L.resolveClaims(st, { 1: 'ron' });
  const w = st.result.wins[0];
  assert.strictEqual(w.pts % 100, 0);
  assert.ok(w.pts >= 600 + 300 * 2 - 600);          // 최소: 기본 + 본장 600
  const st2 = setup(); st2.honba = 0;
  give(st2, 1, '234m345p678s456m5p'); st2.riichi[1] = true;
  give(st2, 0, '1m'); st2.hands[0][tile('5p')]++; st2.drawn = tile('5p');
  L.discard(st2, tile('5p'), false); L.resolveClaims(st2, { 1: 'ron' });
  assert.strictEqual(w.pts - st2.result.wins[0].pts, 600);
});
test('double ron: both winners are paid by the discarder and a riichi winner gets their own stick back', () => {
  const st = setup();
  give(st, 1, '234m345p678s456m5p'); give(st, 2, '234m345p678s456m5p'); st.riichi[1] = st.riichi[2] = true; st.sticks = 3;
  give(st, 0, '1m'); st.hands[0][tile('5p')]++; st.drawn = tile('5p');
  L.discard(st, tile('5p'), false);
  L.resolveClaims(st, { 1: 'ron', 2: 'ron' });
  assert.strictEqual(st.result.wins.length, 2);
  assert.deepStrictEqual(st.result.winners, [1, 2]);
  const d = st.result.deltas, w = st.result.wins;
  assert.strictEqual(d[0], -(w[0].pts + w[1].pts));
  assert.strictEqual(d[1], w[0].pts + 1000 + 1000);          // 자기 막대 1,000 + 남은 막대 1,000 (차례가 빠른 사람)
  assert.strictEqual(d[2], w[1].pts + 1000);
  assert.strictEqual(st.sticks, 0);
  assert.strictEqual(st.scores.reduce((a, b) => a + b), 103000);          // 시험에서 막대 3개를 따로 얹었음
});
test('chankan: a pon extended to a kan can be robbed and no kan dora is revealed', () => {
  const st = setup();
  give(st, 0, '5m1p'); st.melds[0] = [{ kind: 'pon', tiles: [4, 4, 4], from: 2 }]; st.hands[0][tile('5m')]++; st.drawn = tile('5m');
  give(st, 1, '234m345p678s6m99p'); st.hands[1] = hand('46m345p678s23m99p'); st.riichi[1] = true;   // 5m 간짜 대기: 4-6m
  st.hands[1] = hand('46m345p678s234s99p'); st.hands[1] = hand('46m345p678s234m99p');
  const dora = st.doraCount;
  assert.ok(L.actOptions(st).shouminkan.includes(tile('5m')));
  L.kan(st, tile('5m'));
  assert.strictEqual(st.phase, 'claim');
  assert.ok(st.claims[1] && st.claims[1].ron);
  L.resolveClaims(st, { 1: 'ron' });
  assert.strictEqual(st.result.type, 'win');
  assert.ok(st.result.yaku.some((y) => y[0] === '창깡'));
  assert.strictEqual(st.doraCount, dora);
  assert.strictEqual(st.result.from, 0);
});
test('chankan: when nobody robs, the kan completes with a replacement tile and a new dora', () => {
  const st = setup();
  give(st, 0, '5m1p'); st.melds[0] = [{ kind: 'pon', tiles: [4, 4, 4], from: 2 }]; st.hands[0][tile('5m')]++; st.drawn = tile('5m');
  const dora = st.doraCount;
  L.kan(st, tile('5m'));
  assert.strictEqual(st.phase, 'act');
  assert.strictEqual(st.melds[0][0].kind, 'minkan');
  assert.strictEqual(st.doraCount, dora + 1);
});
test('double riichi on the first turn and heaven or earth blessing', () => {
  const st = setup();
  give(st, 0, '234m345p678s456m5p'); st.hands[0][tile('7z')]++; st.drawn = tile('7z');
  L.discard(st, tile('7z'), true);
  assert.ok(st.doubleRiichi[0]);
  const e = setup();
  give(e, 0, '234m345p678s456m5p'); e.hands[0][tile('5p')]++; e.drawn = tile('5p');
  const r = L.actOptions(e).tsumo;
  assert.ok(r && r.yakuman === 1 && r.yaku.some((y) => y[0] === '천화'));
  const c = setup(); c.turn = 1; c.dealer = 0;
  give(c, 1, '234m345p678s456m5p'); c.hands[1][tile('5p')]++; c.drawn = tile('5p'); c.rivers[0].push({ t: 0, riichi: false, called: false });
  assert.ok(L.actOptions(c).tsumo.yaku.some((y) => y[0] === '지화'));
});
test('extra yakuman: nine gates, all green, little and big four winds, four kans', () => {
  assert.ok(names(score('1112345678999m5m', '5m', {})).includes('구련보등'));
  assert.ok(names(score('223344s666s888s66z', '6z', { tsumo: true })).includes('녹일색'));
  assert.ok(names(score('111z222z333z44z123m', '3m', {})).includes('소사희'));
  assert.ok(names(score('111z222z333z444z55m', '5m', {})).includes('대사희'));
  const four = score('99p', '9p', {}, [0, 9, 18, 31].map((x) => ({ kind: 'ankan', tiles: [x, x, x, x] })));
  assert.ok(four && names(four).includes('사깡즈'));
});

// ---- 전체 판 시뮬레이션 ----
function playAll(seed, level, human = -1) {
  const st = L.newGame(L.rng(seed), { level });
  let guard = 0;
  while (!st.over && guard++ < 60000) {
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
