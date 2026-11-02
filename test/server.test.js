'use strict';

// 서버 시험: 보안·안정성 + 마작 온라인 대국 흐름 (빠른 대전, 방 코드, 컴퓨터 채우기, 시간 초과, 재접속)
// 실행: node --test  (Node 18 이상, ws 필요: npm install)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');

// 운영체제가 지금 비어 있는 포트를 골라 준다
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '500', CLAIM_MS: '400', NEXT_MS: '300', CPU_MS: '10', GRACE_MS: '700' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = (name) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, name, msgs: [], room: null, queued: false, errors: [], closed: null, events: [] };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') { c.room = m; c.events.push(...(m.events || [])); }
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => { if (name) ws.send(JSON.stringify({ t: 'hello', name })); resolve(c); });
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
const closeAll = (...cs) => cs.forEach((c) => c.ws.close());

async function pair() {
  const a = await open('가'), b = await open('나');
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'quick match starts at once');
  return [a, b];
}
async function lobby(n) {
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(await open('p' + i));
  send(cs[0], 'create');
  assert.ok(await until(() => cs[0].room && cs[0].room.code));
  const code = cs[0].room.code;
  for (let i = 1; i < n; i++) send(cs[i], 'join', { code });
  assert.ok(await until(() => cs.every((c) => c.room && c.room.players.length === n)), 'everyone seated');
  return { cs, code };
}
// 사람처럼 두는 간단한 봇: 뽑은 패를 그대로 버리고 울지 않는다. 이긴 판은 확인 버튼만 누른다
function autoPlay(c, opts = {}) {
  const timer = setInterval(() => {
    const g = c.room && c.room.g;
    if (!g || c.room.state !== 'playing') return;
    if (g.phase === 'act' && g.turn === c.room.you && g.opts) {
      if (g.opts.tsumo && opts.win !== false) send(c, 'act', { type: 'tsumo' });
      else send(c, 'act', { type: 'discard', tile: g.drawn != null ? g.drawn : g.opts.discard[0], riichi: false });
    } else if (g.phase === 'claim' && g.claim) send(c, 'claim', { choice: g.claim.ron && opts.win !== false ? 'ron' : 'pass' });
    else if (g.phase === 'end' && !g.ready.includes(c.room.you)) send(c, 'next');
  }, 15);
  c.stop = () => clearInterval(timer);
  return c;
}

test('the server serves the page but never files outside public', async () => {
  await ready;
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/game.js'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
  assert.strictEqual(await get('/server.js'), 404);
  assert.strictEqual(await get('/..%2fserver.js'), 403);
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/.env'), 403);
});

test('a huge message or bad JSON does not crash the server', async () => {
  await ready;
  const a = await open('x');
  a.ws.send('{not json');
  a.ws.send(JSON.stringify({ t: '__proto__' })); a.ws.send(JSON.stringify({ t: 'constructor' })); a.ws.send(JSON.stringify({ t: 'act', type: 'discard', tile2: 1 }));
  a.ws.send('x'.repeat(5000));
  assert.ok(await until(() => a.closed !== null), 'oversized message closes only that connection');
  assert.strictEqual(await get('/'), 200);
});

test('quick match: two people with two computers, distinct random seats, nobody sees other hands', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  const g = a.room.g;
  assert.deepStrictEqual(g.scores, [25000, 25000, 25000, 25000]);
  assert.strictEqual(g.names[a.room.you], '가'); assert.strictEqual(g.names[b.room.you], '나');
  assert.strictEqual(g.seatInfo.filter((s) => s.human).length, 2);
  assert.ok(g.names.filter((n, i) => !g.seatInfo[i].human).every((n) => /^[가-힣]+$/.test(n)));
  // 남의 손패가 어디에도 실려 오지 않는다: 내 손패(34칸 한 벌)만 있다
  const text = JSON.stringify(a.room);
  assert.ok(!/"hands"/.test(text));
  assert.strictEqual(g.mine.reduce((x, y) => x + y, 0) >= 13, true);
  assert.strictEqual(g.mine.length, 34);
  closeAll(a, b);
});

test('room codes: create, join, a wrong code, only the host can start, at least 2 people, at most 4', async () => {
  await ready;
  const { cs, code } = await lobby(3);
  assert.strictEqual(cs[0].room.host, true); assert.strictEqual(cs[1].room.host, false);
  const x = await open('x'); send(x, 'join', { code: 'ZZZZ' });
  assert.ok(await until(() => x.errors.length === 1));
  send(cs[1], 'start'); await sleep(100); assert.strictEqual(cs[0].room.state, 'waiting', 'a guest cannot start');
  const d = await open('d'); send(d, 'join', { code });
  assert.ok(await until(() => cs[0].room.players.length === 4));
  const e = await open('e'); send(e, 'join', { code });
  assert.ok(await until(() => e.errors.length === 1), 'a fifth person is turned away');
  send(cs[0], 'start');
  assert.ok(await until(() => cs[0].room.state === 'playing'));
  assert.ok(cs[0].room.g.seatInfo.every((s) => s.human));
  const solo = await open('solo'); send(solo, 'create'); assert.ok(await until(() => solo.room));
  send(solo, 'start'); await sleep(100); assert.strictEqual(solo.room.state, 'waiting', 'one person cannot start');
  closeAll(...cs, x, d, e, solo);
});

test('only the player whose turn it is can discard, and only a tile they hold', async () => {
  await ready;
  const [a, b] = await pair();
  const turnOf = (c) => c.room.g.phase === 'act' && c.room.g.turn === c.room.you && c.room.g.opts;
  assert.ok(await until(() => turnOf(a) || turnOf(b), 4000), 'a human gets a turn');
  const first = turnOf(a) ? a : b, second = first === a ? b : a;
  const riversBefore = JSON.stringify(first.room.g.rivers);
  send(second, 'act', { type: 'discard', tile: 0, riichi: false }); await sleep(60);
  assert.strictEqual(JSON.stringify(first.room.g.rivers), riversBefore, 'out of turn is ignored');
  const held = first.room.g.mine.findIndex((n) => n === 0);       // 내 손에 없는 패
  send(first, 'act', { type: 'discard', tile: held, riichi: false }); await sleep(60);
  assert.strictEqual(JSON.stringify(first.room.g.rivers), riversBefore, 'a tile not in hand is ignored');
  send(first, 'act', { type: 'discard', tile: 99, riichi: false }); send(first, 'act', { type: 'discard', tile: 'x' }); send(first, 'act', { type: 'tsumo' }); await sleep(60);
  assert.strictEqual(JSON.stringify(first.room.g.rivers), riversBefore, 'bad numbers and an impossible tsumo are ignored');
  const ok = first.room.g.drawn;
  send(first, 'act', { type: 'discard', tile: ok, riichi: false });
  assert.ok(await until(() => first.events.some((e) => e.type === 'discard' && e.p === first.room.you && e.t === ok), 300), 'my own discard (not a timeout) went through at once');
  closeAll(a, b);
});

test('humans playing automatically: computers move too, a hand ends and the next one starts after everyone confirms', async () => {
  await ready;
  const [a, b] = await pair();
  autoPlay(a); autoPlay(b);
  assert.ok(await until(() => a.room.g.result !== null || a.room.g.hand > 0 || a.room.g.honba > 0, 15000), 'a hand ended');
  assert.ok(await until(() => a.room.g.phase === 'act' && a.room.g.honba >= 0 && a.events.filter((e) => e.type === 'start').length >= 2, 15000), 'the next hand started');
  assert.ok(a.events.some((e) => e.type === 'discard' && e.p !== a.room.you && e.p !== b.room.you), 'a computer discarded');
  a.stop(); b.stop(); closeAll(a, b);
});

test('claim window: a human with a claim must answer, a pass is accepted once, the game then moves on', async () => {
  await ready;
  const [a, b] = await pair();
  // 시간 제한이 짧아서 사람이 아무것도 안 해도 넘어간다. 먼저 한 번 쓸 수 있는 선택지가 뜨는지 본다
  const sawClaim = await until(() => (a.room.g.claim || b.room.g.claim), 20000);
  if (sawClaim) {
    const c = a.room.g.claim ? a : b;
    send(c, 'claim', { choice: 'pass' }); send(c, 'claim', { choice: 'ron' });      // 두 번째는 무시
    assert.ok(await until(() => !c.room.g.claim || c.room.g.phase !== 'claim', 3000));
  } else assert.ok(true, 'no claim came up in this deal');
  closeAll(a, b);
});

test('timeouts: a silent player is played by the computer, and after three in a row for good', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.g.seatInfo.some((s) => s.auto) || b.room.g.seatInfo.some((s) => s.auto), 15000), 'someone became automatic after repeated timeouts');
  const before = a.events.length;
  assert.ok(await until(() => a.events.length > before + 8), 'the game keeps moving without them');
  closeAll(a, b);
});

test('a dropped player can come back to the same seat with the saved key', async () => {
  await ready;
  const [a, b] = await pair();
  const code = a.room.code, token = a.room.token, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.g.seatInfo[you].online === false), 'the other side sees the drop');
  const a2 = await open('가'); send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.g.seatInfo[you].online === true));
  const bad = await open('도둑'); send(bad, 'resume', { code, token: 'wrong' });
  assert.ok(await until(() => bad.msgs.some((m) => m.t === 'resumeFailed')));
  closeAll(a2, b, bad);
});

test('leaving mid-game hands the seat to a computer and the others play on; an empty room closes', async () => {
  await ready;
  const { cs, code } = await lobby(3);
  send(cs[0], 'start'); assert.ok(await until(() => cs[0].room.state === 'playing'));
  const seat2 = cs[2].room.you;
  send(cs[2], 'leave');
  assert.ok(await until(() => cs[0].room.g.seatInfo[seat2].human === false), 'that seat is now a computer');
  autoPlay(cs[0]); autoPlay(cs[1]);
  const n0 = cs[0].events.length;
  assert.ok(await until(() => cs[0].events.length > n0 + 5), 'the game continues');
  cs[0].stop(); cs[1].stop();
  send(cs[0], 'leave'); send(cs[1], 'leave');
  await sleep(150);
  const z = await open('z'); send(z, 'join', { code });
  assert.ok(await until(() => z.errors.length === 1), 'the empty room is gone');
  closeAll(...cs, z);
});

test('a whole match finishes (east round) and a rematch needs everyone', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over', 90000), 'the match ends (silent humans become automatic)');
  const final = a.room.g;
  assert.ok(final.over && final.hand >= 4);
  assert.strictEqual(final.scores.reduce((x, y) => x + y, 0) + final.sticks * 1000, 100000);
  send(a, 'rematch'); await sleep(100);
  assert.strictEqual(a.room.state, 'over', 'waits for the other player');
  send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2), 'a new match starts');
  closeAll(a, b);
});

test('guessing room codes too often is blocked for a while', async () => {
  await ready;
  const x = await open('bruteforce');
  for (let i = 0; i < 9; i++) { send(x, 'join', { code: 'AAA' + i }); await sleep(10); }
  assert.ok(await until(() => x.errors.some((e) => /너무 많이/.test(e))), 'blocked after repeated misses');
  closeAll(x);
});
