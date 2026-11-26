import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { missions, gate } from './missions.js';
import { world, spawn, exit, characters, distance, withinWorld, dangerAt } from './public/world.js';

const rooms = new Map();
const token = () => randomBytes(24).toString('hex');
const publicMissions = missions.map(({order, sites, consoles, key, ...mission}) => ({
  ...mission, consoles: consoles.map(({x,y}) => ({x,y})), sites: sites.map(({id, name, x, y, note, kind}) => ({id,name,x,y,note,kind}))
}));
const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'],
  '/world.js': ['world.js', 'text/javascript'], '/terrain.js': ['terrain.js', 'text/javascript'] };
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
function send(res, data, status = 200) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
}
function event(res, type, data) {
  res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n');
}
function online(room) {
  return [...room.members.values()].filter(member => member.streams.size);
}
function players(room) {
  return online(room).map(({id, name, color, character, x, y, face, teacher}) => ({id, name, color, character, x, y, face, teacher}));
}
function broadcast(room) {
  const state = {activity:room.activity, messages:room.messages, players:players(room)};
  for (const member of online(room)) for (const stream of member.streams) event(stream, 'state', state);
}
function sendJournal(member) {
  for (const stream of member.streams) event(stream, 'journal', member.journal);
}
function emptyJournal() {
  return missions.map(() => ({notes:{}, tokens:{}, routes:{}, done:false}));
}
function respawn(room, member, now) {
  if (member.protectedUntil > now || !dangerAt(member, now)) return false;
  Object.assign(member, spawn, {face:1, journal:emptyJournal(), protectedUntil:now+3500, movedAt:now, falls:member.falls+1});
  room.activity.push({name:member.name, color:member.color, restart:true, time:now});
  room.activity = room.activity.slice(-300);
  for (const stream of member.streams) event(stream, 'respawn', {x:member.x,y:member.y,falls:member.falls});
  sendJournal(member);
  broadcast(room);
  return true;
}
function add(room, name, choice, teacher = false) {
  const index = room.members.size;
  const character = characters.find(option => option.id === choice);
  if (!character) throw fail('캐릭터를 선택하세요.');
  const member = {id: randomBytes(8).toString('hex'), name, teacher, character:character.id, color:character.coat,
    x:spawn.x + index % 9 * 32 - 128, y:spawn.y + Math.floor(index / 9) * 28 - 56, face:1,
    journal:emptyJournal(), falls:0, protectedUntil:0,
    streams:new Set(), seen:Date.now()};
  const key = token();
  room.members.set(key, member);
  return {key, id: member.id, code: room.code, teacher};
}
function near(member, target) {
  if (distance(member, target) > world.reach) throw fail('직접 걸어가 가까이에서 조사하세요.', 409);
}
function missionOf(index) {
  if (!Number.isInteger(index) || !missions[index]) throw fail('미션을 찾을 수 없어요.', 404);
  return missions[index];
}
function normalized(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/[\s.!?·-]/g, '').toLowerCase() : '';
}
function nameOf(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 18) throw fail('별명을 1~18자로 입력하세요.');
  return name;
}
async function input(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16000) throw fail('요청이 너무 큽니다.', 413);
  }
  try { return JSON.parse(raw || '{}') ?? {}; } catch { throw fail('요청 형식을 확인하세요.'); }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && Object.hasOwn(files, path)) {
      const [file, type] = files[path];
      const contents = await readFile(new URL('./public/' + file, import.meta.url));
      res.writeHead(200, {'Content-Type': type + '; charset=utf-8'});
      return res.end(contents);
    }
    if (req.method === 'GET' && path === '/api/missions') return send(res, publicMissions);
    if (req.method === 'GET' && path === '/api/health') return send(res, {ok: true});
    if (req.method === 'POST' && path === '/api/create') {
      const body = await input(req);
      const name = nameOf(body.name);
      if (rooms.size >= 200) throw fail('열 수 있는 방 수를 초과했어요.', 429);
      let code;
      do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      const room = {code, members: new Map(), activity: [], messages: []};
      const credentials = add(room, name, body.character, true);
      rooms.set(code, room);
      return send(res, credentials);
    }
    const body = req.method === 'POST' ? await input(req) : {};
    const room = rooms.get(String(body.code ?? url.searchParams.get('code')).trim().toUpperCase());
    if (!room) throw fail('해당 입장 코드의 방을 찾을 수 없어요.', 404);
    if (req.method === 'POST' && path === '/api/join') {
      if (room.members.size >= 50) throw fail('이 방의 학생 정원은 49명이에요.', 409);
      return send(res, add(room, nameOf(body.name), body.character));
    }
    const key = body.key ?? url.searchParams.get('key');
    const member = room.members.get(key);
    if (!member) throw fail('입장 정보가 만료되었어요.', 401);
    member.seen = Date.now();
    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'});
      res.write(': connected\n\n');
      event(res, 'clock', Date.now());
      member.streams.add(res);
      const timer = setInterval(() => event(res, 'clock', Date.now()), 15000);
      res.on('close', () => { clearInterval(timer); member.streams.delete(res); member.seen = Date.now(); broadcast(room); });
      broadcast(room);
      event(res, 'life', member.falls);
      sendJournal(member);
      return;
    }
    if (req.method !== 'POST') throw fail('요청을 찾을 수 없어요.', 404);
    const now = Date.now();
    if (path !== '/api/resume' && body.falls !== member.falls) throw fail('출발 기지에서 다시 시작하세요.', 409);
    switch (path) {
      case '/api/resume': return send(res, {falls:member.falls});
      case '/api/move':
        if (Number.isFinite(body.x) && Number.isFinite(body.y)) {
          const point = withinWorld(body);
          const elapsed = member.movedAt ? now - member.movedAt : 100;
          const allowance = Math.max(70, Math.min(420, elapsed * world.speed / 1000 + 38));
          if (distance(member, point) > allowance) throw fail('이동 위치가 동기화되지 않았어요.', 409);
          Object.assign(member, point, {face:body.face === -1 ? -1 : 1, movedAt:now});
          respawn(room, member, now);
          room.moved = true;
        }
        return send(res, {x:member.x, y:member.y, falls:member.falls});
      case '/api/chat': {
        const message = String(body.message ?? '').trim();
        if (!message || message.length > 300) throw fail('메시지는 1~300자로 입력하세요.');
        room.messages.push({name: member.name, message, color: member.color});
        room.messages = room.messages.slice(-40);
        broadcast(room);
        break;
      }
      case '/api/inspect': {
        const mission = missionOf(body.mission);
        const journal = member.journal[body.mission];
        if (body.kind === 'route') {
          const route = mission.consoles[body.fragment];
          if (!Number.isInteger(body.fragment) || !route) throw fail('안내판을 찾을 수 없어요.', 404);
          near(member, route);
          journal.routes[body.fragment] = route.text;
          sendJournal(member);
          return send(res, {text:route.text});
        }
        const site = mission.sites.find(site => site.id === body.site);
        if (!site) throw fail('탐험 지점을 찾을 수 없어요.', 404);
        if (body.kind === 'note') {
          near(member, site.note);
          journal.notes[site.id] = site.clue;
          sendJournal(member);
          return send(res, {clue:site.clue});
        }
        near(member, site);
        return send(res, {prompt:site.prompt});
      }
      case '/api/answer': {
        const mission = missionOf(body.mission);
        const journal = member.journal[body.mission];
        const site = mission.sites.find(site => site.id === body.site);
        if (!site) throw fail('탐험 지점을 찾을 수 없어요.', 404);
        near(member, site);
        if (!journal.notes[site.id]) throw fail('이 자물쇠와 연결된 현장 단서를 먼저 찾아 기록하세요.', 409);
        if (!site.answers.includes(normalized(body.answer))) return send(res, {correct:false, feedback:'아직 잠겨 있어요. 탐험 수첩의 단서와 초성을 다시 맞춰 보세요.'});
        const found = {symbol:site.symbol, digit:site.digit};
        journal.tokens[site.id] = found;
        sendJournal(member);
        return send(res, {correct:true, feedback:site.detail, found});
      }
      case '/api/unlock': {
        const mission = missionOf(body.mission);
        const journal = member.journal[body.mission];
        near(member, mission);
        if (mission.sites.some(site => !journal.tokens[site.id]) || Object.keys(journal.routes).length !== mission.consoles.length) {
          throw fail('표식 네 개와 안내판 두 곳의 기록이 필요해요.', 409);
        }
        const code = mission.order.map(symbol => mission.sites.find(site => site.symbol === symbol).digit).join('');
        if (normalized(body.answer) !== code) return send(res, {correct:false, feedback:'코드가 달라요. 안내판의 이야기 순서대로 숫자를 이어 보세요.'});
        if (!journal.done) {
          journal.done = true;
          journal.key = mission.key;
          room.activity.push({name:member.name, color:member.color, mission:body.mission, time:Date.now()});
          room.activity = room.activity.slice(-300);
          sendJournal(member);
          broadcast(room);
        }
        return send(res, {correct:true, key:journal.key});
      }
      case '/api/gate':
        near(member, exit);
        if (!member.journal.every(entry => entry.done)) throw fail('세 구역의 금고를 모두 열어야 해요.', 409);
        return send(res, {clue:gate.clue, legend:gate.legend});
      case '/api/leave':
        if (!member.journal.every(entry => entry.done)) throw fail('세 구역의 자물쇠를 모두 열면 퇴장할 수 있어요.', 409);
        near(member, exit);
        if (normalized(body.answer) !== gate.code) return send(res, {correct:false,feedback:'게이트가 잠겨 있어요. 물건의 순서를 다시 확인하세요.'});
        room.members.delete(key);
        for (const stream of member.streams) stream.end();
        broadcast(room);
        break;
      default: throw fail('요청을 찾을 수 없어요.', 404);
    }
    send(res, {ok: true});
  } catch (error) {
    if (!res.headersSent) send(res, {error: error.status ? error.message : '서버 오류가 발생했어요.'}, error.status || 500);
    else res.end();
  }
}).listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('Atlas Escape server ready'));

setInterval(() => {
  for (const [code, room] of rooms) {
    for (const [key, member] of room.members) if (!member.streams.size && Date.now() - member.seen > 30 * 60 * 1000) room.members.delete(key);
    if (!room.members.size) rooms.delete(code);
  }
}, 60000).unref();

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const member of online(room)) respawn(room, member, now);
    if (!room.moved) continue;
    room.moved = false;
    const positions = players(room).map(({id,x,y,face}) => ({id,x,y,face}));
    for (const member of online(room)) for (const stream of member.streams) event(stream, 'positions', positions);
  }
}, 100).unref();
