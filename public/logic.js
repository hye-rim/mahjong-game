'use strict';
// 마작(일본식 리치 마작, 간소화): 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 패 종류 34가지: 0~8 만수, 9~17 통수, 18~26 삭수, 27~30 동남서북, 31 백, 32 발, 33 중.
(function (root) {
  const EAST = 27, HAKU = 31, HATSU = 32, CHUN = 33;
  const isHonor = (t) => t >= 27;
  const isTerm = (t) => t >= 27 || t % 9 === 0 || t % 9 === 8;      // 노두패 또는 자패
  const isSimple = (t) => t < 27 && t % 9 > 0 && t % 9 < 8;
  const suitOf = (t) => (t < 27 ? Math.floor(t / 9) : 3);
  const SUIT_NAME = ['만', '통', '삭'];
  const HONOR_NAME = ['동', '남', '서', '북', '백', '발', '중'];
  const tileName = (t) => (t < 27 ? `${(t % 9) + 1}${SUIT_NAME[Math.floor(t / 9)]}` : HONOR_NAME[t - 27]);

  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const counts = () => new Array(34).fill(0);
  const total = (c) => c.reduce((a, b) => a + b, 0);

  // ---------- 모양 판정 ----------
  // 같은 패 종류 묶음(삼조)과 순서 묶음(순자)으로 나누는 모든 방법. need = 필요한 묶음 수(멜드 제외)
  function decompose(c, need) {
    const out = [], a = c.slice();
    for (let p = 0; p < 34; p++) {
      if (a[p] < 2) continue;
      a[p] -= 2;
      const sets = [];
      const rec = (i) => {
        while (i < 34 && a[i] === 0) i++;
        if (i >= 34) { if (sets.length === need) out.push({ sets: sets.map((s) => ({ k: s.k, t: s.t })), pair: p }); return; }
        if (sets.length >= need) return;
        if (a[i] >= 3) { a[i] -= 3; sets.push({ k: 'tri', t: i }); rec(i); sets.pop(); a[i] += 3; }
        if (i < 27 && i % 9 <= 6 && a[i + 1] > 0 && a[i + 2] > 0) { a[i]--; a[i + 1]--; a[i + 2]--; sets.push({ k: 'seq', t: i }); rec(i); sets.pop(); a[i]++; a[i + 1]++; a[i + 2]++; }
      };
      rec(0);
      a[p] += 2;
    }
    return out;
  }
  const KOKUSHI = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const isChiitoi = (c) => { let pairs = 0; for (let i = 0; i < 34; i++) { if (c[i] === 2) pairs++; else if (c[i] !== 0) return false; } return pairs === 7; };
  const isKokushi = (c) => { let pair = 0; for (let i = 0; i < 34; i++) { if (KOKUSHI.includes(i)) { if (c[i] === 0 || c[i] > 2) return false; if (c[i] === 2) pair++; } else if (c[i] !== 0) return false; } return pair === 1; };
  // 완성형인가 (c 는 멜드를 뺀 손패, nMelds 는 멜드 수)
  function isAgari(c, nMelds) {
    if (total(c) !== 14 - 3 * nMelds) return false;
    if (nMelds === 0 && (isChiitoi(c) || isKokushi(c))) return true;
    return decompose(c, 4 - nMelds).length > 0;
  }

  // ---------- 향청수(샤텐) ----------
  function regularShanten(c, nMelds) {
    let best = 8;
    const a = c.slice();
    const dfs = (i, m, t, p) => {
      while (i < 34 && a[i] === 0) i++;
      if (i >= 34) { const s = 8 - 2 * m - Math.min(t, 4 - m) - (p ? 1 : 0); if (s < best) best = s; return; }
      if (a[i] >= 3) { a[i] -= 3; dfs(i, m + 1, t, p); a[i] += 3; }
      if (i < 27 && i % 9 <= 6 && a[i + 1] > 0 && a[i + 2] > 0) { a[i]--; a[i + 1]--; a[i + 2]--; dfs(i, m + 1, t, p); a[i]++; a[i + 1]++; a[i + 2]++; }
      if (!p && a[i] >= 2) { a[i] -= 2; dfs(i, m, t, 1); a[i] += 2; }
      if (a[i] >= 2) { a[i] -= 2; dfs(i, m, t + 1, p); a[i] += 2; }
      if (i < 27 && i % 9 <= 7 && a[i + 1] > 0) { a[i]--; a[i + 1]--; dfs(i, m, t + 1, p); a[i]++; a[i + 1]++; }
      if (i < 27 && i % 9 <= 6 && a[i + 2] > 0) { a[i]--; a[i + 2]--; dfs(i, m, t + 1, p); a[i]++; a[i + 2]++; }
      a[i]--; dfs(i, m, t, p); a[i]++;
    };
    dfs(0, nMelds, 0, 0);
    return best;
  }
  function shanten(c, nMelds) {
    let s = regularShanten(c, nMelds);
    if (nMelds === 0) {
      let pairs = 0, kinds = 0;
      for (let i = 0; i < 34; i++) { if (c[i] >= 1) kinds++; if (c[i] >= 2) pairs++; }
      s = Math.min(s, 6 - pairs + Math.max(0, 7 - kinds));
      let k = 0, pr = 0;
      for (const t of KOKUSHI) { if (c[t] >= 1) k++; if (c[t] >= 2) pr = 1; }
      s = Math.min(s, 13 - k - pr);
    }
    return s;
  }
  // 13-3n 장 손패가 기다리는 패(완성되는 패) 목록
  function waitsOf(c, nMelds) {
    const w = [];
    for (let t = 0; t < 34; t++) { if (c[t] >= 4) continue; c[t]++; if (isAgari(c, nMelds)) w.push(t); c[t]--; }
    return w;
  }

  // ---------- 역과 점수 ----------
  const nextDora = (ind) => {
    if (ind < 27) return ind % 9 === 8 ? ind - 8 : ind + 1;
    if (ind < 31) return ind === 30 ? 27 : ind + 1;
    return ind === 33 ? 31 : ind + 1;
  };
  // 기본점: 5판 이상은 한도(만관 2000 · 하네만 3000 · 배만 4000 · 삼배만 6000), 역만 8000, 그 밖에는 부수 x 2^(판+2) (1900 넘으면 2000)
  const baseOf = (han, fu, yakuman) => {
    if (yakuman) return 8000 * yakuman;
    if (han >= 11) return 6000; if (han >= 8) return 4000; if (han >= 6) return 3000; if (han >= 5) return 2000;
    const b = fu * Math.pow(2, han + 2);
    return b > 1900 ? 2000 : b;
  };
  const HAN_PTS = baseOf;
  const up100 = (x) => Math.ceil(x / 100) * 100;

  // 한 가지 나눔에 대한 역 (부수 계산은 하지 않는다)
  function regularYaku(cx, sets, pair, wait) {
    const ys = [], yk = [];
    const all = [];
    sets.forEach((s) => { if (s.k === 'seq') all.push(s.t, s.t + 1, s.t + 2); else all.push(s.t, s.t, s.t); });
    all.push(pair, pair);
    const tris = sets.filter((s) => s.k === 'tri'), seqs = sets.filter((s) => s.k === 'seq');
    const concealedTri = tris.filter((s) => !s.open).length;
    // 역만
    if (all.every((t) => t >= 27)) yk.push('자일색');
    if (all.every((t) => t < 27 && (t % 9 === 0 || t % 9 === 8))) yk.push('청노두');
    if (tris.filter((s) => s.t >= HAKU).length === 3) yk.push('대삼원');
    if (concealedTri === 4 && cx.menzen) yk.push('사암각');
    if (sets.filter((s) => s.kan).length === 4) yk.push('사깡즈');
    const windTris = tris.filter((s) => s.t >= 27 && s.t < 31).length;
    if (windTris === 4) yk.push('대사희'); else if (windTris === 3 && pair >= 27 && pair < 31) yk.push('소사희');
    if (all.every((t) => [19, 20, 21, 23, 25, 32].includes(t))) yk.push('녹일색');
    if (yk.length) return { ys: [], yk, fu: 0 };
    let pinfu = false;
    if (cx.menzen && sets.every((s) => s.k === 'seq') && pair !== HAKU && pair !== HATSU && pair !== CHUN && pair !== cx.seat && pair !== cx.round && wait === 'ryanmen') { ys.push(['핀후', 1]); pinfu = true; }
    if (all.every(isSimple)) ys.push(['탕야오', 1]);
    if (cx.menzen) {
      const key = {}; seqs.forEach((s) => { key[s.t] = (key[s.t] || 0) + 1; });
      const same = Object.values(key).reduce((a, n) => a + Math.floor(n / 2), 0);
      if (same >= 2) ys.push(['량페코', 3]); else if (same === 1) ys.push(['일배구', 1]);
    }
    for (const s of tris) {
      if (s.t >= HAKU) ys.push([`역패 ${tileName(s.t)}`, 1]);
      if (s.t === cx.seat) ys.push(['자풍', 1]);
      if (s.t === cx.round) ys.push(['장풍', 1]);
    }
    if (tris.length === 4) ys.push(['또이또이', 2]);
    if (concealedTri >= 3) ys.push(['산안커', 2]);
    if (sets.filter((s) => s.kan).length === 3) ys.push(['산깡즈', 2]);
    for (let n = 0; n < 7; n++) if ([0, 1, 2].every((su) => seqs.some((s) => s.t === su * 9 + n))) { ys.push(['삼색동순', cx.menzen ? 2 : 1]); break; }
    for (let su = 0; su < 3; su++) if ([0, 3, 6].every((n) => seqs.some((s) => s.t === su * 9 + n))) { ys.push(['일기통관', cx.menzen ? 2 : 1]); break; }
    for (let n = 0; n < 9; n++) if ([0, 1, 2].every((su) => tris.some((s) => s.t === su * 9 + n))) { ys.push(['삼색동각', 2]); break; }
    const termSet = (s) => (s.k === 'seq' ? s.t % 9 === 0 || s.t % 9 === 6 : isTerm(s.t));
    if (sets.every(termSet) && isTerm(pair)) {
      if (seqs.length) ys.push(all.some(isHonor) ? ['찬타', cx.menzen ? 2 : 1] : ['준찬타', cx.menzen ? 3 : 2]);
      else if (all.some(isHonor)) ys.push(['혼노두', 2]);
    }
    if (tris.filter((s) => s.t >= HAKU).length === 2 && pair >= HAKU) ys.push(['소삼원', 2]);
    flushYaku(cx, all, ys);
    return { ys, yk, fu: fuOf(cx, sets, pair, wait, pinfu) };
  }
  // 부수: 기본 20, 멘젠 론 +10, 쯔모 +2(핀후 제외), 커쯔·깡, 역패 머리 +2, 대기 +2, 문 연 핀후 모양은 30
  function fuOf(cx, sets, pair, wait, pinfu) {
    let fu = 20;
    if (cx.menzen && !cx.tsumo) fu += 10;
    if (cx.tsumo && !pinfu) fu += 2;
    for (const s of sets) if (s.k === 'tri') { let f = isTerm(s.t) ? 4 : 2; if (s.kan) f *= 4; if (!s.open) f *= 2; fu += f; }
    if (pair >= HAKU || pair === cx.seat || pair === cx.round) fu += 2;
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    if (!cx.menzen && fu === 20) fu = 22;
    return Math.ceil(fu / 10) * 10;
  }
  function flushYaku(cx, all, ys) {
    const suits = new Set(all.filter((t) => t < 27).map(suitOf));
    const honors = all.some(isHonor);
    if (suits.size === 1 && !honors) ys.push(['청일색', cx.menzen ? 6 : 5]);
    else if (suits.size === 1 && honors) ys.push(['혼일색', cx.menzen ? 3 : 2]);
  }

  // 이 손패(멜드 포함)로 이겼을 때 가장 높은 점수. 역이 없으면 null.
  // melds: [{kind, tiles}], closed: 완성된 손패(멜드 제외) 개수 배열, tile: 이긴 패
  function scoreHand(cx, closed, melds, tile) {
    const nM = melds.length;
    const meldSets = melds.map((m) => ({ k: m.kind === 'chi' ? 'seq' : 'tri', t: m.tiles[0], open: m.kind !== 'ankan', kan: m.kind === 'minkan' || m.kind === 'ankan' }));
    const tileCount = counts();
    closed.forEach((n, t) => { tileCount[t] += n; });
    melds.forEach((m) => m.tiles.forEach((t) => { tileCount[t]++; }));
    let best = null;
    const consider = (ys, yk, fu) => {
      if (cx.first && cx.tsumo && nM === 0) yk = yk.concat(cx.first === 'tenhou' ? ['천화'] : ['지화']);
      let han, names, ymn = 0;
      if (yk.length) { ymn = yk.length; han = 13 * ymn; names = yk.map((n) => [n, 13]); }
      else {
        const list = ys.slice();
        if (cx.doubleRiichi) list.push(['더블 리치', 2]); else if (cx.riichi) list.push(['리치', 1]);
        if (cx.ippatsu) list.push(['일발', 1]);
        if (cx.tsumo && cx.menzen) list.push(['멘젠 쯔모', 1]);
        if (cx.rinshan) list.push(['영상개화', 1]);
        if (cx.chankan) list.push(['창깡', 1]);
        if (cx.haitei) list.push(['해저로월', 1]);
        if (cx.houtei) list.push(['하저로어', 1]);
        if (!list.length) return;
        han = list.reduce((a, b) => a + b[1], 0); names = list;
      }
      const dora = cx.doras.reduce((a, d) => a + tileCount[d], 0), ura = cx.riichi ? cx.uras.reduce((a, d) => a + tileCount[d], 0) : 0;
      if (!ymn) han += dora + ura;
      const r = { han, fu: ymn ? 0 : fu, yaku: names, yakuman: ymn, dora: ymn ? 0 : dora, ura: ymn ? 0 : ura, base: baseOf(han, fu, ymn) };
      if (!best || r.base > best.base || (r.base === best.base && (r.han > best.han || (r.han === best.han && r.fu > best.fu)))) best = r;
    };
    if (nM === 0 && isKokushi(closed)) consider([], ['국사무쌍'], 0);
    if (nM === 0) {                                          // 구련보등: 한 무늬 1112345678999 + 한 장
      for (let su = 0; su < 3; su++) {
        const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
        if (closed.every((n, t) => (t >= su * 9 && t < su * 9 + 9 ? n >= base[t - su * 9] : n === 0))) consider([], ['구련보등'], 0);
      }
    }
    if (nM === 0 && isChiitoi(closed)) {
      const ys = [['치또이츠', 2]], all = [];
      for (let t = 0; t < 34; t++) if (closed[t]) all.push(t, t);
      if (all.every(isSimple)) ys.push(['탕야오', 1]);
      if (all.every(isTerm) && all.some((t) => t < 27) && all.some(isHonor)) ys.push(['혼노두', 2]);
      if (all.every(isHonor)) consider([], ['자일색'], 0);
      else if (all.every((t) => t < 27 && (t % 9 === 0 || t % 9 === 8))) consider([], ['청노두'], 0);
      else { flushYaku(cx, all, ys); consider(ys, [], 25); }
    }
    for (const d of decompose(closed, 4 - nM)) {
      // 이긴 패가 어디에 들어갔다고 볼 수 있는지 모두 시험 (론으로 완성된 삼조는 열린 것으로 침)
      const slots = [];
      d.sets.forEach((s, i) => {
        if (s.k === 'tri' && s.t === tile) slots.push({ i, wait: 'shanpon' });
        if (s.k === 'seq' && tile >= s.t && tile <= s.t + 2) {
          const pos = tile - s.t;
          const wait = pos === 1 ? 'kanchan' : (pos === 0 && s.t % 9 === 6) || (pos === 2 && s.t % 9 === 0) ? 'penchan' : 'ryanmen';
          slots.push({ i, wait });
        }
      });
      if (d.pair === tile) slots.push({ i: -1, wait: 'tanki' });
      for (const sl of slots) {
        const sets = d.sets.map((s, i) => ({ k: s.k, t: s.t, open: !cx.tsumo && i === sl.i && s.k === 'tri', kan: false })).concat(meldSets);
        const r = regularYaku(cx, sets, d.pair, sl.wait);
        consider(r.ys, r.yk, r.fu);
      }
    }
    return best;
  }

  // ---------- 판 만들기 ----------
  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const level = opts.level === 'easy' ? 'easy' : 'normal';
    const st = { rand, level, hand: 0, honba: 0, played: 0, scores: [25000, 25000, 25000, 25000], over: false, events: [], names: opts.names || ['나', '하나', '두리', '세나'], sticks: 0, results: [] };
    startHand(st);
    return st;
  }
  function startHand(st) {
    const tiles = [];
    for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) tiles.push(t);
    for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    st.dealer = st.hand;                                   // 친은 한 판마다 돌아간다(연장 없음)
    st.hands = [0, 1, 2, 3].map(() => counts());
    for (let i = 0; i < 52; i++) st.hands[Math.floor(i / 13)][tiles.pop()]++;
    st.dead = tiles.splice(0, 14);                         // 왕패: 0~3 영상패, 4,6,8,10,12 도라 표시, 5,7,9,11,13 뒷도라 표시
    st.wall = tiles;
    st.melds = [[], [], [], []];
    st.rivers = [[], [], [], []];
    st.riichi = [false, false, false, false]; st.ippatsu = [false, false, false, false]; st.doubleRiichi = [false, false, false, false]; st.anyCall = false; st.pendingKan = null;
    st.furiten = [false, false, false, false];             // 임시(내가 버릴 때까지) 후리텐
    st.riichiFuriten = [false, false, false, false];       // 리치 뒤 놓친 론(영구)
    st.doraCount = 1; st.kans = 0; st.rinshan = false; st.noDiscard = []; st.pendingRiichi = -1;
    st.turn = st.dealer; st.drawn = null; st.lastDiscard = null; st.claims = {}; st.result = null; st.firstRound = true;
    st.events.push({ type: 'start', hand: st.hand });
    draw(st);
  }
  const seatWind = (st, p) => EAST + ((p - st.dealer + 4) % 4);
  const doraIndicators = (st) => Array.from({ length: st.doraCount }, (_, i) => st.dead[4 + 2 * i]);
  const doraTiles = (st) => doraIndicators(st).map(nextDora);
  const uraTiles = (st) => Array.from({ length: st.doraCount }, (_, i) => nextDora(st.dead[5 + 2 * i]));
  const isMenzen = (st, p) => st.melds[p].every((m) => m.kind === 'ankan');

  function draw(st) {
    if (st.wall.length === 0) { exhaust(st); return; }
    const t = st.wall.pop();
    st.hands[st.turn][t]++; st.drawn = t; st.phase = 'act'; st.rinshan = false;
    st.events.push({ type: 'draw', p: st.turn });
  }
  function rinshanDraw(st) {       // 왕패 앞 4장이 영상패. 산 패 끝에서 한 장을 왕패로 옮겨 14장을 유지
    const t = st.dead[st.kans - 1];
    st.dead[st.kans - 1] = st.wall.shift();            // 쓴 자리에 산 패 끝의 한 장을 채움(패 수 보존)
    st.hands[st.turn][t]++; st.drawn = t; st.phase = 'act'; st.rinshan = true;
    st.events.push({ type: 'rinshan', p: st.turn });
  }

  // ---------- 선택지 ----------
  function winCtx(st, p, tsumo, extra) {
    const first = tsumo && st.rivers[p].length === 0 && !st.anyCall ? (p === st.dealer ? 'tenhou' : 'chiihou') : null;
    return Object.assign({ menzen: isMenzen(st, p), tsumo, riichi: st.riichi[p], doubleRiichi: st.doubleRiichi[p], ippatsu: st.ippatsu[p], rinshan: tsumo && st.rinshan, haitei: tsumo && st.wall.length === 0 && !st.rinshan, houtei: !tsumo && st.wall.length === 0 && !(extra && extra.chankan),
      first, seat: seatWind(st, p), round: EAST, doras: doraTiles(st), uras: uraTiles(st) }, extra || {});
  }
  function evalWin(st, p, tile, tsumo, extra) {
    const c = st.hands[p].slice();
    if (!tsumo) c[tile]++;
    if (!isAgari(c, st.melds[p].length)) return null;
    return scoreHand(winCtx(st, p, tsumo, extra), c, st.melds[p], tile);
  }
  const waitsNow = (st, p, c) => waitsOf(c || st.hands[p].slice(), st.melds[p].length);
  const isFuriten = (st, p) => {
    if (st.furiten[p] || st.riichiFuriten[p]) return true;
    const w = waitsNow(st, p);
    return w.some((t) => st.rivers[p].some((r) => r.t === t));
  };

  // 지금 차례인 사람이 할 수 있는 것
  function actOptions(st) {
    if (st.phase !== 'act') return null;
    const p = st.turn, c = st.hands[p], nm = st.melds[p].length;
    const o = { tsumo: null, riichi: [], ankan: [], shouminkan: [], discard: [] };
    if (st.drawn != null) o.tsumo = evalWin(st, p, st.drawn, true);
    for (let t = 0; t < 34; t++) if (c[t] > 0 && !st.noDiscard.includes(t)) o.discard.push(t);
    if (st.riichi[p]) { o.discard = st.drawn != null ? [st.drawn] : []; return o; }
    if (isMenzen(st, p) && st.scores[p] >= 1000 && st.wall.length >= 1 && st.drawn != null) {
      for (const t of o.discard) { c[t]--; if (shanten(c, nm) === 0) o.riichi.push(t); c[t]++; }
    }
    if (st.kans < 4 && st.wall.length > 0 && st.drawn != null) {
      for (let t = 0; t < 34; t++) if (c[t] === 4) o.ankan.push(t);
      for (const m of st.melds[p]) if (m.kind === 'pon' && c[m.tiles[0]] > 0) o.shouminkan.push(m.tiles[0]);
    }
    return o;
  }

  function discard(st, t, riichi) {
    const p = st.turn;
    const o = actOptions(st);
    if (!o || !o.discard.includes(t)) throw new Error('버릴 수 없는 패');
    if (riichi) { if (!o.riichi.includes(t)) throw new Error('리치할 수 없음'); st.doubleRiichi[p] = st.rivers[p].length === 0 && !st.anyCall; st.riichi[p] = true; st.pendingRiichi = p; st.ippatsu[p] = true; st.events.push({ type: 'riichi', p }); }
    else if (st.riichi[p]) st.ippatsu[p] = false;                  // 리치 뒤 내 두 번째 버림부터 일발은 끝
    st.hands[p][t]--; st.rivers[p].push({ t, riichi: !!riichi, called: false });
    st.furiten[p] = false; st.noDiscard = []; st.drawn = null; st.rinshan = false;
    st.lastDiscard = { p, t };
    st.events.push({ type: 'discard', p, t });
    if (st.firstRound && st.rivers.every((r) => r.length >= 1)) st.firstRound = false;
    // 다른 사람의 선택지
    st.claims = {};
    for (let q = 0; q < 4; q++) {
      if (q === p) continue;
      const cl = claimOptions(st, q, p, t);
      if (cl) st.claims[q] = cl;
    }
    st.phase = 'claim';
    if (!Object.keys(st.claims).length) advance(st);
  }
  function claimOptions(st, q, from, t) {
    const c = st.hands[q], nm = st.melds[q].length, o = {};
    if (!isFuriten(st, q) && waitsNow(st, q).includes(t) && evalWin(st, q, t, false)) o.ron = true;
    if (st.wall.length > 0 && !st.riichi[q]) {
      if (c[t] >= 2) o.pon = true;
      if (c[t] >= 3 && st.kans < 4) o.kan = true;
      if (q === (from + 1) % 4 && t < 27) {
        const chis = [];
        const n = t % 9;
        const has = (x) => c[x] > 0;
        if (n >= 2 && has(t - 2) && has(t - 1)) chis.push([t - 2, t - 1]);
        if (n >= 1 && n <= 7 && has(t - 1) && has(t + 1)) chis.push([t - 1, t + 1]);
        if (n <= 6 && has(t + 1) && has(t + 2)) chis.push([t + 1, t + 2]);
        if (chis.length) o.chi = chis;
      }
    }
    return Object.keys(o).length ? o : null;
  }

  // 모두의 선택을 모아 처리. choices[p] = 'ron' | 'pon' | 'kan' | {chi:[a,b]} | 'pass'
  function resolveClaims(st, choices) {
    if (st.phase !== 'claim') throw new Error('선택할 때가 아님');
    const from = st.lastDiscard.p, t = st.lastDiscard.t;
    const order = [1, 2, 3].map((d) => (from + d) % 4).filter((q) => st.claims[q]);
    // 론을 안 한 사람은 후리텐(리치 중이면 영구)
    for (const q of order) if (st.claims[q].ron && choices[q] !== 'ron') { st.furiten[q] = true; if (st.riichi[q]) st.riichiFuriten[q] = true; }
    const rons = order.filter((q) => st.claims[q].ron && choices[q] === 'ron');   // 론이 여럿이면 모두 이긴다
    if (st.pendingKan) {                                    // 창깡: 론이 없으면 깡을 마저 한다
      const pk = st.pendingKan; st.pendingKan = null; st.claims = {};
      if (rons.length) { win(st, rons, false, from, t, { chankan: true }); return; }
      completeKan(st, pk.p, pk.t); return;
    }
    if (rons.length) {
      if (st.pendingRiichi >= 0) { st.riichi[st.pendingRiichi] = false; st.doubleRiichi[st.pendingRiichi] = false; st.pendingRiichi = -1; }   // 론당한 리치는 선언이 성립하지 않음
      win(st, rons, false, from, t); return;
    }
    const pon = order.find((q) => (choices[q] === 'pon' && st.claims[q].pon) || (choices[q] === 'kan' && st.claims[q].kan));
    const chi = order.find((q) => choices[q] && choices[q].chi && st.claims[q].chi && st.claims[q].chi.some((x) => x[0] === choices[q].chi[0] && x[1] === choices[q].chi[1]));
    const who = pon != null ? pon : chi;
    if (who == null) { advance(st); return; }
    commitRiichi(st);
    st.ippatsu = [false, false, false, false]; st.anyCall = true;
    st.rivers[from][st.rivers[from].length - 1].called = true;
    const c = st.hands[who];
    const ch = choices[who];
    if (ch === 'kan') {
      c[t] -= 3; st.melds[who].push({ kind: 'minkan', tiles: [t, t, t, t], from, called: t });
      st.kans++; st.turn = who; st.noDiscard = [];
      st.events.push({ type: 'call', p: who, kind: 'kan', t });
      rinshanDraw(st); st.doraCount = Math.min(5, st.doraCount + 1); st.events.push({ type: 'dora' });
    } else if (ch === 'pon') {
      c[t] -= 2; st.melds[who].push({ kind: 'pon', tiles: [t, t, t], from, called: t });
      st.turn = who; st.drawn = null; st.noDiscard = [t]; st.phase = 'act'; st.rinshan = false;
      st.events.push({ type: 'call', p: who, kind: 'pon', t });
    } else {
      const [a, b] = ch.chi; c[a]--; c[b]--;
      const tl = [a, b, t].sort((x, y) => x - y);
      st.melds[who].push({ kind: 'chi', tiles: tl, from, called: t });
      st.turn = who; st.drawn = null; st.phase = 'act'; st.rinshan = false;
      // 방금 부른 패와 같은 패, 반대쪽 끝 패는 바로 버리지 못한다(쿠이카에)
      const nd = [t];
      if (t === tl[0] && tl[0] % 9 <= 5) nd.push(tl[0] + 3);
      if (t === tl[2] && tl[2] % 9 >= 3) nd.push(tl[2] - 3);
      st.noDiscard = nd.filter((x) => x >= 0 && x < 27);
      st.events.push({ type: 'call', p: who, kind: 'chi', t });
    }
    st.claims = {};
    // 낼 수 있는 패가 하나도 없으면 제한을 푼다
    if (st.phase === 'act') { const o = actOptions(st); if (o && !o.discard.length) st.noDiscard = []; }
  }
  function commitRiichi(st) { if (st.pendingRiichi >= 0) { st.scores[st.pendingRiichi] -= 1000; st.sticks++; st.pendingRiichi = -1; } }
  function advance(st) {          // 아무도 안 불렀다: 다음 사람이 뽑는다
    commitRiichi(st);
    st.claims = {};
    if (st.wall.length === 0) { exhaust(st); return; }
    st.turn = (st.lastDiscard.p + 1) % 4;
    draw(st);
  }

  // 암깡·가깡 (가깡은 다른 사람이 창깡으로 론할 수 있다)
  function kan(st, t) {
    const o = actOptions(st), p = st.turn;
    if (!o) throw new Error('지금은 깡 할 수 없음');
    if (o.shouminkan.includes(t)) {
      const claims = {};
      for (let q = 0; q < 4; q++) {
        if (q === p) continue;
        if (!isFuriten(st, q) && waitsNow(st, q).includes(t) && evalWin(st, q, t, false, { chankan: true })) claims[q] = { ron: true };
      }
      if (Object.keys(claims).length) {
        st.pendingKan = { p, t }; st.lastDiscard = { p, t, chankan: true }; st.claims = claims; st.phase = 'claim';
        return;
      }
    } else if (!o.ankan.includes(t)) throw new Error('깡 할 수 없는 패');
    completeKan(st, p, t);
  }
  function completeKan(st, p, t) {
    const c = st.hands[p];
    if (c[t] === 4) { c[t] -= 4; st.melds[p].push({ kind: 'ankan', tiles: [t, t, t, t], from: -1, called: t }); }
    else { c[t]--; const m = st.melds[p].find((x) => x.kind === 'pon' && x.tiles[0] === t); m.kind = 'minkan'; m.tiles = [t, t, t, t]; }
    st.turn = p; st.kans++; st.ippatsu = [false, false, false, false]; st.noDiscard = []; st.anyCall = true; st.claims = {};
    st.events.push({ type: 'call', p, kind: 'kan', t });
    rinshanDraw(st); st.doraCount = Math.min(5, st.doraCount + 1); st.events.push({ type: 'dora' });
  }
  function tsumo(st) {
    const o = actOptions(st);
    if (!o || !o.tsumo) throw new Error('쯔모 할 수 없음');
    win(st, [st.turn], true, -1, st.drawn);
  }

  // ---------- 끝 ----------
  // 이긴 사람들(론이 여럿이면 모두)에게 점수를 준다. EMA 규칙: 본장 막대와 리치 막대는 따로 계산
  function win(st, winners, tsumoWin, from, tile, extra) {
    const d = [0, 0, 0, 0], wins = [];
    for (const w of winners) {
      const r = evalWin(st, w, tile, tsumoWin, extra);
      const dealerWin = w === st.dealer, b = r.base, h = st.honba;
      let gain = 0;
      if (tsumoWin) {
        for (let q = 0; q < 4; q++) {
          if (q === w) continue;
          const pay = up100(dealerWin || q === st.dealer ? 2 * b : b) + 100 * h;
          d[q] -= pay; d[w] += pay; gain += pay;
        }
      } else {
        gain = up100((dealerWin ? 6 : 4) * b) + 300 * h;
        d[from] -= gain; d[w] += gain;
      }
      wins.push({ winner: w, han: r.han, fu: r.fu, yaku: r.yaku, yakuman: r.yakuman, dora: r.dora, ura: r.ura, base: r.base, pts: gain });
    }
    // 리치 막대: 이긴 사람 중 리치한 사람은 자기 것을 되찾고, 나머지는 차례가 가장 빠른 사람이 가져간다
    let pool = st.sticks * 1000;
    for (const w of winners) if (st.riichi[w] && pool > 0) { d[w] += 1000; pool -= 1000; }
    d[winners[0]] += pool;
    const sticksWon = st.sticks; st.sticks = 0;
    for (let q = 0; q < 4; q++) st.scores[q] += d[q];
    st.result = Object.assign({ type: 'win', winner: winners[0], winners, from, tsumo: tsumoWin, tile, deltas: d, sticks: sticksWon, wins }, wins[0], { winner: winners[0] });
    finishHand(st);
  }
  function exhaust(st) {
    commitRiichi(st);
    const tenpai = [0, 1, 2, 3].map((p) => waitsNow(st, p).length > 0);
    const n = tenpai.filter(Boolean).length, d = [0, 0, 0, 0];
    if (n > 0 && n < 4) for (let p = 0; p < 4; p++) d[p] = tenpai[p] ? 3000 / n : -3000 / (4 - n);
    for (let p = 0; p < 4; p++) st.scores[p] += d[p];
    st.result = { type: 'draw', tenpai, deltas: d };
    finishHand(st);
  }
  function finishHand(st) {
    st.phase = 'end'; st.claims = {}; st.drawn = null;
    st.results.push(st.result);
    st.events.push({ type: 'end', result: st.result });
  }
  // 다음 판으로. 친이 이기거나 유국에 텐파이면 친이 그대로(본장 +1), 아니면 친이 넘어간다. 북 친이 끝나면 게임 끝
  function nextHand(st) {
    if (st.phase !== 'end') throw new Error('아직 판이 안 끝남');
    const r = st.result;
    let repeat;
    if (r.type === 'win') { repeat = r.winners.includes(st.dealer); st.honba = repeat ? st.honba + 1 : 0; }
    else { repeat = r.tenpai[st.dealer]; st.honba++; }
    st.played++;
    if (!repeat) st.hand++;
    if (st.hand >= 4) { st.over = true; st.phase = 'over'; st.events.push({ type: 'over' }); return; }
    startHand(st);
  }
  // 마지막 순위 (같은 점수는 먼저 앉은 사람이 위)
  function ranking(st) { return [0, 1, 2, 3].sort((a, b) => st.scores[b] - st.scores[a] || a - b); }

  // ---------- 컴퓨터 ----------
  // 밖에 보이는 패 수(강 + 멜드; 불려 간 패는 멜드에서만 센다)
  const countAll = (st, t) => { let n = 0; for (let p = 0; p < 4; p++) { st.rivers[p].forEach((r) => { if (r.t === t && !r.called) n++; }); st.melds[p].forEach((m) => m.tiles.forEach((x) => { if (x === t) n++; })); } return n; };
  const visibleBy = (st, p, t) => countAll(st, t) + st.hands[p][t];
  function dangerOf(st, p, t) {            // 리치한 사람에게 내는 위험도(작을수록 안전)
    let worst = 0;
    for (let q = 0; q < 4; q++) {
      if (q === p || !st.riichi[q]) continue;
      if (st.rivers[q].some((r) => r.t === t)) continue;             // 현물
      let d;
      if (t >= 27) d = visibleBy(st, p, t) >= 3 ? 1 : visibleBy(st, p, t) >= 2 ? 3 : 5;
      else { const n = t % 9; d = n === 0 || n === 8 ? 3 : n === 1 || n === 7 ? 5 : n === 2 || n === 6 ? 6 : 8; }
      worst = Math.max(worst, d);
    }
    return worst;
  }
  function aiDiscard(st, p) {
    const o = actOptions(st), c = st.hands[p], nm = st.melds[p].length;
    if (st.riichi[p]) return { t: o.discard[0] };
    const options = o.discard.map((t) => { c[t]--; const sh = shanten(c, nm); c[t]++; return { t, sh }; });
    const minSh = Math.min(...options.map((x) => x.sh));
    const defend = st.level === 'normal' && minSh >= 1 && st.riichi.some((r, q) => r && q !== p);   // 리치가 걸렸는데 내 손이 멀면 안전한 패부터
    let pool;
    if (defend) { options.forEach((x) => { x.dg = dangerOf(st, p, x.t); }); const lo = Math.min(...options.map((x) => x.dg)); pool = options.filter((x) => x.dg <= lo + (lo <= 3 ? 0 : 1)); }
    else pool = options.filter((x) => x.sh === minSh);
    const doras = doraTiles(st);
    let best = null;
    for (const x of pool) {
      c[x.t]--;
      let uke = 0;
      for (let u = 0; u < 34; u++) { if (c[u] >= 4) continue; c[u]++; if (shanten(c, nm) < x.sh) uke += Math.max(0, 4 - visibleBy(st, p, u)); c[u]--; }
      c[x.t]++;
      let val = uke * 10 - (doras.includes(x.t) ? 30 : 0) + (isHonor(x.t) ? 3 : 0) + (isTerm(x.t) ? 2 : 0) - (x.t === seatWind(st, p) || x.t === EAST || x.t >= HAKU ? 4 : 0);
      if (defend) val -= x.dg * 100;
      if (st.level === 'easy') val += st.rand() * 40;
      if (!best || val > best.val) best = { t: x.t, val };
    }
    return { t: best.t };
  }
  // 컴퓨터의 한 수. 반환: { action: 'tsumo' | 'kan' | 'discard', t, riichi }
  function aiAct(st) {
    const p = st.turn, o = actOptions(st), c = st.hands[p], nm = st.melds[p].length;
    if (o.tsumo) return { action: 'tsumo' };
    const anyRiichi = st.riichi.some((r, q) => r && q !== p);
    if (st.level === 'normal' && !st.riichi[p] && !anyRiichi && shanten(c, nm) <= 1) for (const t of o.ankan) return { action: 'kan', t };
    if (o.riichi.length && (st.level === 'normal' || st.rand() < 0.5)) {        // 텐파이가 되는 버림 중 기다림이 가장 넓은 것
      let pick = null;
      for (const t of o.riichi) { c[t]--; const w = waitsOf(c, nm).reduce((a, x) => a + 4 - visibleBy(st, p, x), 0); c[t]++; if (!pick || w > pick.w) pick = { t, w }; }
      return { action: 'discard', t: pick.t, riichi: true };
    }
    return { action: 'discard', t: aiDiscard(st, p).t };
  }
  function aiClaim(st, q) {
    const o = st.claims[q], t = st.lastDiscard.t, c = st.hands[q], nm = st.melds[q].length;
    if (o.ron) return 'ron';
    const yakuhai = t >= HAKU || t === seatWind(st, q) || t === EAST;
    if (st.level === 'easy') return o.pon && yakuhai && st.rand() < 0.7 ? 'pon' : 'pass';
    const before = shanten(c, nm);
    const dangerous = st.riichi.some((r, p) => r && p !== q);
    if (o.kan && yakuhai && !dangerous && before <= 2) return 'kan';
    if (o.pon && yakuhai) return 'pon';
    // 그 밖의 울기는 탕야오로 갈 때만
    const tanyaoish = () => [...Array(34).keys()].every((x) => !c[x] || isSimple(x)) && st.melds[q].every((m) => m.tiles.every(isSimple)) && isSimple(t);
    if (dangerous || !tanyaoish()) return 'pass';
    if (o.pon) { c[t] -= 2; const after = shanten(c, nm + 1); c[t] += 2; if (after < before) return 'pon'; }
    if (o.chi) for (const ch of o.chi) { c[ch[0]]--; c[ch[1]]--; const after = shanten(c, nm + 1); c[ch[0]]++; c[ch[1]]++; if (after < before) return { chi: ch }; }
    return 'pass';
  }
  // 지금 차례인 사람(컴퓨터 또는 자리를 비운 사람)의 한 수를 컴퓨터가 대신 둔다
  function aiPlay(st) {
    const a = aiAct(st);
    if (a.action === 'tsumo') tsumo(st);
    else if (a.action === 'kan') kan(st, a.t);
    else discard(st, a.t, a.riichi);
  }
  // 사람이 아닌 차례일 때 한 번 진행
  function aiStep(st, human) {
    if (st.phase === 'act' && st.turn !== human) { aiPlay(st); return true; }
    return false;
  }
  // 사람 말고 모두의 선택을 정해서 처리 (human 은 자기 선택을 주거나 null)
  function settleClaims(st, human, humanChoice) {
    const ch = {};
    for (const q of Object.keys(st.claims).map(Number)) ch[q] = q === human ? (humanChoice || 'pass') : aiClaim(st, q);
    resolveClaims(st, ch);
  }

  // 판이 끝났을 때 이긴 사람(과 유국의 텐파이 사람)의 손패를 결과에 붙여 공개한다
  function withReveal(st) {
    const r = st.result; if (!r) return null;
    const reveal = {};
    const show = (p, tile) => { const c = st.hands[p].slice(); if (tile != null) c[tile]++; reveal[p] = { hand: c, melds: st.melds[p].map((m) => ({ kind: m.kind, tiles: m.tiles })) }; };
    if (r.type === 'win') r.winners.forEach((w) => show(w, r.tsumo ? null : r.tile));
    else r.tenpai.forEach((t, p) => { if (t) show(p, null); });
    return Object.assign({}, r, { reveal });
  }

  const api = { rng, tileName, isHonor, isTerm, isSimple, decompose, isAgari, isChiitoi, isKokushi, shanten, regularShanten, waitsOf, scoreHand, nextDora, HAN_PTS,
    newGame, startHand, ranking, withReveal, actOptions, discard, kan, tsumo, resolveClaims, claimOptions, nextHand, aiAct, aiPlay, aiClaim, aiStep, settleClaims, aiDiscard, evalWin, isFuriten, waitsNow, seatWind, doraIndicators, doraTiles, uraTiles, isMenzen, counts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_MJ = api;
})(typeof window !== 'undefined' ? window : globalThis);
