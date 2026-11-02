'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
// 규칙과 컴퓨터는 브라우저와 같은 코드를 쓴다. 패 섞기는 서버가 하고, 남의 손패는 보내지 않는다
const L = require('./public/logic.js');
const rand = () => crypto.randomInt(1 << 30) / (1 << 30);

// ---------- Config ----------
const PORT = process.env.PORT || 3024;
const TURN_MS = Number(process.env.TURN_MS) || 30000;    // 내 차례에 패를 버리는 제한 시간. 넘기면 컴퓨터가 대신 둔다. 시험에서는 환경변수로 줄인다
const CLAIM_MS = Number(process.env.CLAIM_MS) || 12000;  // 남이 버린 패에 론·퐁·치를 고르는 제한 시간(넘기면 컴퓨터가 대신 고른다)
const NEXT_MS = Number(process.env.NEXT_MS) || 20000;    // 한 판이 끝난 뒤 모두가 확인 버튼을 누를 때까지 기다리는 시간
const CPU_MS = Number(process.env.CPU_MS) || 700;        // 컴퓨터가 한 번 움직이는 간격 (화면 연출 시간)
const GRACE_MS = Number(process.env.GRACE_MS) || 30000;  // 대국 중 연결이 끊겨도 이 시간 안에 돌아오면 이어서 한다
const MAX_IDLE = 3;                                      // 연달아 시간을 넘기면 그 사람은 컴퓨터가 맡는다
const MAX_SEATS = 4;
const HEARTBEAT_MS = 25000;
const SILENCE_TIMEOUT_MS = 90000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CPU_NAMES = ['하나', '두리', '세나', '네리'];

// ---------- Static file server ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
function safeDecode(s) {
  try {
    const d = decodeURIComponent(s);
    return d.includes('\0') ? null : d;
  } catch { return null; }
}
function isServable(filePath, baseDir) {
  const inside = filePath === baseDir || filePath.startsWith(baseDir + path.sep);
  return inside && !filePath.slice(baseDir.length).split(path.sep).some((seg) => seg.startsWith('.'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  let reqPath = safeDecode(req.url.split('?')[0]);
  if (reqPath === null) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bad request'); return; }
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!isServable(filePath, PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// 메시지 크기 제한: 이 게임의 메시지는 모두 작다
const wss = new WebSocketServer({ server, maxPayload: 1024 });

// ---------- 방 코드 무차별 대입 방지 ----------
const JOIN_FAIL_MAX = 8, JOIN_WINDOW_MS = 60000, JOIN_BLOCK_MS = 60000;
const joinFails = new Map();
const clientIp = (req) => String((req && req.headers['x-forwarded-for']) || (req && req.socket.remoteAddress) || '').split(',')[0].trim();
const joinBlocked = (ip) => { const f = joinFails.get(ip); return !!f && f.until > Date.now(); };
function noteJoinFail(ip) {
  const now = Date.now();
  let f = joinFails.get(ip);
  if (!f || now - f.since > JOIN_WINDOW_MS) f = { n: 0, since: now, until: 0 };
  f.n++;
  if (f.n >= JOIN_FAIL_MAX) { f.until = now + JOIN_BLOCK_MS; f.n = 0; f.since = now; }
  joinFails.set(ip, f);
  if (joinFails.size > 2000) for (const [k, v] of joinFails) if (v.until < now && now - v.since > JOIN_WINDOW_MS) joinFails.delete(k);
}

// ---------- State ----------
const rooms = new Map();
const clients = new Map();
let queue = null;
let nextId = 1;

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ t: type, ...payload }));
}
function makeCode() {
  for (let k = 0; k < 50; k++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return 'R' + Date.now().toString(36).slice(-3).toUpperCase();
}
const makeToken = () => crypto.randomBytes(18).toString('base64url');
function sanitizeName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8);
  return name || `손님${Math.floor(100 + Math.random() * 900)}`;
}

// ---------- Rooms ----------
function createRoom(isPrivate) {
  const room = {
    code: makeCode(), isPrivate, seats: [], byPos: [null, null, null, null], game: null, state: 'waiting', deadline: 0,
    turnTimer: null, cpuTimer: null, events: [], evCursor: 0, rematch: new Set(), games: 0, choices: {}, ready: new Set(),
  };
  rooms.set(room.code, room);
  return room;
}
const seatOf = (room, client) => room.seats.find((s) => s.client === client);
// 사람이 직접 두는 자리인가 (컴퓨터 자리, 떠난 자리, 컴퓨터가 맡은 자리는 아님)
const isHuman = (room, pos) => { const s = room.byPos[pos]; return !!s && !s.gone && !s.auto; };

// 손님마다 보내는 상태. 내 손패만 보내고 남의 손패는 보내지 않는다
function snapshot(room, seat, events) {
  const st = room.game;
  const base = { code: room.code, you: seat.pos == null ? seat.index : seat.pos, token: seat.token, state: room.state, games: room.games, host: room.seats[0] === seat, rematch: [...room.rematch], events: events || [] };
  if (!st) return { ...base, players: room.seats.map((s) => ({ name: s.name, online: s.online })) };
  const me = seat.pos, o = st.phase === 'act' && st.turn === me ? L.actOptions(st) : null;
  const claim = st.phase === 'claim' && st.claims[me] && room.choices[me] === undefined ? st.claims[me] : null;
  const myCount = st.hands[me].reduce((a, b) => a + b, 0);
  const g = {
    names: st.names, hand: st.hand, honba: st.honba, dealer: st.dealer, wall: st.wall.length, ind: L.doraIndicators(st), scores: st.scores, sticks: st.sticks,
    rivers: st.rivers, melds: st.melds.map((ms) => ms.map((m) => ({ kind: m.kind, tiles: m.tiles }))), riichi: st.riichi, phase: st.phase, turn: st.turn, last: st.lastDiscard, over: st.over,
    mine: st.hands[me], drawn: st.turn === me && st.phase === 'act' ? st.drawn : null,
    opts: o ? { tsumo: o.tsumo ? { han: o.tsumo.han, yakuman: o.tsumo.yakuman } : null, riichi: o.riichi, ankan: o.ankan, shouminkan: o.shouminkan, discard: o.discard } : null,
    claim, furiten: myCount === 13 - 3 * st.melds[me].length && L.waitsNow(st, me).length > 0 ? L.isFuriten(st, me) : false,
    waits: myCount === 13 - 3 * st.melds[me].length ? L.waitsNow(st, me) : [],
    seatInfo: [0, 1, 2, 3].map((p) => ({ human: isHuman(room, p), online: !!(room.byPos[p] && room.byPos[p].online), auto: !!(room.byPos[p] && room.byPos[p].auto) })),
    waiting: st.phase === 'claim' ? Object.keys(st.claims).map(Number).filter((q) => isHuman(room, q) && room.choices[q] === undefined) : [],
    ready: [...room.ready],
    result: st.phase === 'end' || st.phase === 'over' ? L.withReveal(st) : null,
    remain: room.deadline ? Math.max(0, room.deadline - Date.now()) : 0,
  };
  return { ...base, g };
}
function pushRoom(room) {
  const st = room.game;
  let events = [];
  if (st) { events = st.events.slice(room.evCursor).map(slimEvent); room.evCursor = st.events.length; }
  for (const s of room.seats) if (s.online) send(s.client.ws, 'room', snapshot(room, s, events));
}
const slimEvent = (e) => (e.type === 'end' ? { type: 'end' } : e);

function sitDown(room, client) {
  const seat = { client, name: client.name, index: room.seats.length, pos: null, token: makeToken(), online: true, graceTimer: null, idle: 0, gone: false, auto: false };
  room.seats.push(seat);
  client.roomCode = room.code;
  if (!room.isPrivate && room.seats.length === 2) startGame(room);       // 빠른 대전은 둘이 모이면 바로
  else pushRoom(room);
}

function startGame(room) {
  room.seats = room.seats.filter((s) => !s.gone);
  const humans = room.seats.length;
  if (humans < 2) return;
  // 자리(동남서북)는 무작위로 섞는다. 사람이 아닌 자리는 컴퓨터
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  room.byPos = [null, null, null, null];
  const names = ['', '', '', ''];
  const spare = CPU_NAMES.filter((n) => !room.seats.some((s) => s.name === n));
  room.seats.forEach((s, i) => { s.idle = 0; s.auto = false; s.pos = order[i]; room.byPos[order[i]] = s; names[order[i]] = s.name; });
  for (let p = 0; p < 4; p++) if (!room.byPos[p]) names[p] = spare.shift() || `컴퓨터${p}`;
  room.game = L.newGame(rand, { level: 'normal', names });
  room.state = 'playing'; room.events = []; room.evCursor = 0; room.rematch.clear(); room.games++; room.choices = {}; room.ready = new Set();
  tick(room);
}

// ---------- 진행 ----------
const clearTimers = (room) => { clearTimeout(room.turnTimer); clearTimeout(room.cpuTimer); room.deadline = 0; };
// 다음에 일어날 일을 잡는다: 컴퓨터(또는 자리를 비운 사람) 차례면 잠시 뒤 스스로 움직이고, 사람 차례면 제한 시간을 잰다
function tick(room) {
  clearTimers(room);
  const st = room.game;
  if (!st || room.state !== 'playing') return;
  if (st.phase === 'over') return endMatch(room);
  if (st.phase === 'end') {
    room.ready = new Set(); for (let p = 0; p < 4; p++) if (!isHuman(room, p)) room.ready.add(p);
    if (room.ready.size >= 4) { room.cpuTimer = setTimeout(() => nextHand(room), CPU_MS * 2); }
    else { room.deadline = Date.now() + NEXT_MS; room.turnTimer = setTimeout(() => nextHand(room), NEXT_MS); }
    return pushRoom(room);
  }
  if (st.phase === 'act') {
    if (isHuman(room, st.turn)) { room.deadline = Date.now() + TURN_MS; room.turnTimer = setTimeout(() => onActTimeout(room), TURN_MS); }
    else room.cpuTimer = setTimeout(() => cpuMove(room), CPU_MS);
    return pushRoom(room);
  }
  if (st.phase === 'claim') {
    const humans = Object.keys(st.claims).map(Number).filter((q) => isHuman(room, q));
    if (!humans.length) { room.cpuTimer = setTimeout(() => settle(room), CPU_MS / 2); }
    else { room.deadline = Date.now() + CLAIM_MS; room.turnTimer = setTimeout(() => onClaimTimeout(room), CLAIM_MS); }
    return pushRoom(room);
  }
}
function cpuMove(room) {
  if (room.state !== 'playing' || room.game.phase !== 'act') return;
  L.aiPlay(room.game);
  tick(room);
}
// 시간을 넘기면 컴퓨터가 한 번 대신 두고, 연달아 넘기면 그 자리는 컴퓨터가 맡는다
function onActTimeout(room) {
  if (room.state !== 'playing' || room.game.phase !== 'act') return;
  const seat = room.byPos[room.game.turn];
  if (seat) { seat.idle++; if (seat.idle >= MAX_IDLE) seat.auto = true; }
  L.aiPlay(room.game);
  tick(room);
}
// 모두의 선택(사람이 안 고른 자리는 컴퓨터가 대신)을 모아 처리
function settle(room) {
  const st = room.game;
  if (room.state !== 'playing' || st.phase !== 'claim') return;
  const ch = {};
  for (const q of Object.keys(st.claims).map(Number)) ch[q] = room.choices[q] !== undefined ? room.choices[q] : L.aiClaim(st, q);
  room.choices = {};
  L.resolveClaims(st, ch);
  tick(room);
}
function onClaimTimeout(room) {
  if (room.state !== 'playing' || room.game.phase !== 'claim') return;
  for (const q of Object.keys(room.game.claims).map(Number)) if (isHuman(room, q) && room.choices[q] === undefined) { const s = room.byPos[q]; if (s) { s.idle++; if (s.idle >= MAX_IDLE) s.auto = true; } }
  settle(room);
}
function nextHand(room) {
  const st = room.game;
  if (room.state !== 'playing' || st.phase !== 'end') return;
  L.nextHand(st);
  room.choices = {};
  tick(room);
}
function endMatch(room) {
  if (room.state !== 'playing') return;
  clearTimers(room);
  room.state = 'over';
  pushRoom(room);
}
function closeRoom(room) {
  clearTimers(room);
  for (const s of room.seats) { clearTimeout(s.graceTimer); if (s.client) s.client.roomCode = null; }
  rooms.delete(room.code);
}
// 사람이 자리를 떠난다: 대국 중이면 그 자리는 컴퓨터가 이어받는다
function vacate(room, seat) {
  clearTimeout(seat.graceTimer);
  const wasHost = room.seats[0] === seat;
  if (room.state === 'playing') {
    seat.gone = true; seat.online = false; if (seat.client) seat.client.roomCode = null; seat.client = null;
    if (room.seats.every((s) => s.gone || s.auto)) { closeRoom(room); return; }
    tick(room); return;
  }
  if (room.state === 'waiting') {
    if (wasHost) { for (const s of room.seats) if (s !== seat && s.online) send(s.client.ws, 'error', { msg: '방장이 나가서 방이 닫혔어요.' }); closeRoom(room); return; }
    room.seats = room.seats.filter((s) => s !== seat);
    room.seats.forEach((s, i) => { s.index = i; });
    if (seat.client) seat.client.roomCode = null;
    pushRoom(room); return;
  }
  seat.gone = true; seat.online = false; if (seat.client) seat.client.roomCode = null; seat.client = null;     // over
  room.rematch.delete(seat.index);
  if (room.seats.every((s) => s.gone)) { closeRoom(room); return; }
  pushRoom(room);
}
const dropFromQueue = (client) => { if (queue === client) queue = null; };

// ---------- Handlers ----------
const isTile = (t) => Number.isInteger(t) && t >= 0 && t < 34;
const handlers = {
  hello(client, msg) { client.name = sanitizeName(msg.name); },

  quick(client) {
    if (client.roomCode) return;
    if (queue && queue !== client && queue.ws.readyState === queue.ws.OPEN) {
      const other = queue; queue = null;
      const room = createRoom(false);
      sitDown(room, other); sitDown(room, client);
    } else { queue = client; send(client.ws, 'queued'); }
  },
  create(client) { if (client.roomCode) return; dropFromQueue(client); sitDown(createRoom(true), client); },
  join(client, msg) {
    if (client.roomCode) return;
    dropFromQueue(client);
    if (joinBlocked(client.ip)) return send(client.ws, 'error', { msg: '방 코드를 너무 많이 틀렸어요. 1분 뒤에 다시 해 주세요.' });
    const room = rooms.get(String(msg.code || '').trim().toUpperCase());
    if (!room) { noteJoinFail(client.ip); return send(client.ws, 'error', { msg: '그런 방이 없어요. 코드를 확인해 주세요.' }); }
    if (room.state !== 'waiting') return send(client.ws, 'error', { msg: '이미 시작한 방이에요.' });
    if (room.seats.length >= MAX_SEATS) return send(client.ws, 'error', { msg: '방이 가득 찼어요. (최대 4명)' });
    sitDown(room, client);
  },
  start(client) {
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (!seat || room.state !== 'waiting' || room.seats[0] !== seat || room.seats.length < 2) return;
    startGame(room);
  },
  resume(client, msg) {
    const room = rooms.get(String(msg.code || ''));
    const seat = room && room.seats.find((s) => s.token === msg.token && !s.gone);
    if (!seat) return send(client.ws, 'resumeFailed');
    if (seat.client && seat.client !== client && seat.client.ws.readyState === seat.client.ws.OPEN) {
      seat.client.roomCode = null;
      send(seat.client.ws, 'error', { msg: '다른 창에서 이 대국에 다시 들어왔어요.' });
    }
    clearTimeout(seat.graceTimer);
    seat.client = client; seat.online = true; client.name = seat.name; client.roomCode = room.code;
    if (seat.auto) { seat.auto = false; seat.idle = 0; }
    if (room.state === 'playing') tick(room); else pushRoom(room);
  },
  cancel(client) {
    dropFromQueue(client);
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (seat && room.state === 'waiting') vacate(room, seat);
  },

  // 내 차례에 할 수 있는 일: 규칙에 어긋나면 L 의 함수가 거절한다
  act(client, msg) {
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    const st = room && room.game;
    if (!seat || room.state !== 'playing' || st.phase !== 'act' || st.turn !== seat.pos || !isHuman(room, seat.pos)) return;
    try {
      if (msg.type === 'discard') { if (!isTile(msg.tile)) return; L.discard(st, msg.tile, msg.riichi === true); }
      else if (msg.type === 'tsumo') L.tsumo(st);
      else if (msg.type === 'kan') { if (!isTile(msg.tile)) return; L.kan(st, msg.tile); }
      else return;
    } catch { return; }
    seat.idle = 0;
    tick(room);
  },
  // 남이 버린 패에 대한 선택
  claim(client, msg) {
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    const st = room && room.game;
    if (!seat || room.state !== 'playing' || st.phase !== 'claim' || !st.claims[seat.pos] || room.choices[seat.pos] !== undefined) return;
    let choice;
    if (msg.choice === 'ron' || msg.choice === 'pon' || msg.choice === 'kan' || msg.choice === 'pass') choice = msg.choice;
    else if (Array.isArray(msg.chi) && msg.chi.length === 2 && msg.chi.every(isTile)) choice = { chi: [msg.chi[0], msg.chi[1]] };
    else return;
    room.choices[seat.pos] = choice;
    seat.idle = 0;
    const waiting = Object.keys(st.claims).map(Number).filter((q) => isHuman(room, q) && room.choices[q] === undefined);
    if (waiting.length) pushRoom(room); else settle(room);
  },
  // 판이 끝난 뒤 다음 판으로 가자는 확인
  next(client) {
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (!seat || room.state !== 'playing' || room.game.phase !== 'end') return;
    room.ready.add(seat.pos);
    if (room.ready.size >= 4) nextHand(room); else pushRoom(room);
  },

  rematch(client) {
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (!seat || room.state !== 'over') return;
    room.rematch.add(seat.index);
    const stay = room.seats.filter((s) => !s.gone);
    if (stay.length >= 2 && stay.every((s) => room.rematch.has(s.index))) startGame(room);
    else pushRoom(room);
  },
  leave(client) {
    dropFromQueue(client);
    const room = rooms.get(client.roomCode);
    const seat = room && seatOf(room, client);
    if (seat) vacate(room, seat);
  },
  pulse() {},
};

// ---------- Connections ----------
function onDisconnect(client) {
  dropFromQueue(client);
  const room = rooms.get(client.roomCode);
  const seat = room && seatOf(room, client);
  if (!seat) return;
  if (room.state !== 'playing') { vacate(room, seat); return; }
  seat.online = false; seat.client = null;
  seat.graceTimer = setTimeout(() => vacate(room, seat), GRACE_MS);
  pushRoom(room);
}

const heartbeat = setInterval(() => { for (const ws of wss.clients) ws.ping(); }, HEARTBEAT_MS);
const silenceSweep = setInterval(() => {
  const now = Date.now();
  for (const [ws, client] of clients) if (now - client.lastSeen > SILENCE_TIMEOUT_MS) ws.terminate();
}, 5000);
wss.on('close', () => { clearInterval(heartbeat); clearInterval(silenceSweep); });

wss.on('connection', (ws, req) => {
  ws.on('error', () => {});
  const client = { id: nextId++, ws, ip: clientIp(req), name: sanitizeName(''), roomCode: null, lastSeen: Date.now() };
  clients.set(ws, client);
  ws.on('message', (raw) => {
    client.lastSeen = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const handler = msg && typeof msg.t === 'string' && Object.prototype.hasOwnProperty.call(handlers, msg.t) ? handlers[msg.t] : null;
    if (handler) handler(client, msg);
  });
  ws.on('close', () => { onDisconnect(client); clients.delete(ws); });
});

server.listen(PORT, () => { console.log(`마작 서버 실행 중 → http://localhost:${PORT}`); });
