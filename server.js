import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { missions } from './missions.js';

const rooms = new Map();
const token = () => randomBytes(24).toString('hex');
const colors = ['#6cf5d0', '#f8a873', '#a6a0ff', '#f993bd', '#95dfff', '#ffdc7f'];
const publicMissions = missions.map(({questions, ...mission}) => ({
  ...mission, questions: questions.map(({q, options}) => ({q, options}))
}));
const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
function send(res, data, status = 200) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
}
function event(res, type, data) {
  res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n');
}
function snapshot(room) {
  return {code: room.code, activity: room.activity, messages: room.messages,
    players: [...room.members.values()].filter(player => player.streams.size).map(({id, name, color, x, y, teacher, progress}) => ({id, name, color, x, y, teacher, progress}))};
}
function broadcast(room) {
  const state = snapshot(room);
  for (const member of room.members.values()) for (const stream of member.streams) event(stream, 'state', state);
}
function add(room, name, teacher = false) {
  const index = room.members.size;
  const member = {id: randomBytes(8).toString('hex'), name, teacher, color: colors[index % colors.length],
    x: 42 + index % 8 * 2, y: 83 + Math.floor(index / 8) * 2, progress: [0, 0, 0], streams: new Set(), seen: Date.now()};
  const key = token();
  room.members.set(key, member);
  return {key, id: member.id, code: room.code, teacher};
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
      const name = nameOf((await input(req)).name);
      if (rooms.size >= 200) throw fail('열 수 있는 방 수를 초과했어요.', 429);
      let code;
      do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      const room = {code, members: new Map(), activity: [], messages: []};
      rooms.set(code, room);
      return send(res, add(room, name, true));
    }
    const body = req.method === 'POST' ? await input(req) : {};
    const room = rooms.get(String(body.code ?? url.searchParams.get('code')).trim().toUpperCase());
    if (!room) throw fail('해당 입장 코드의 방을 찾을 수 없어요.', 404);
    if (req.method === 'POST' && path === '/api/join') {
      if (room.members.size >= 50) throw fail('이 방의 학생 정원은 49명이에요.', 409);
      return send(res, add(room, nameOf(body.name)));
    }
    const key = body.key ?? url.searchParams.get('key');
    const member = room.members.get(key);
    if (!member) throw fail('입장 정보가 만료되었어요.', 401);
    member.seen = Date.now();
    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'});
      res.write(': connected\n\n');
      member.streams.add(res);
      const timer = setInterval(() => res.write(': ping\n\n'), 15000);
      res.on('close', () => { clearInterval(timer); member.streams.delete(res); member.seen = Date.now(); broadcast(room); });
      broadcast(room);
      return;
    }
    if (req.method !== 'POST') throw fail('요청을 찾을 수 없어요.', 404);
    switch (path) {
      case '/api/resume': break;
      case '/api/move':
        if (Number.isFinite(body.x) && Number.isFinite(body.y)) {
          member.x = Math.max(4, Math.min(96, body.x));
          member.y = Math.max(12, Math.min(93, body.y));
          broadcast(room);
        }
        break;
      case '/api/chat': {
        const message = String(body.message ?? '').trim();
        if (!message || message.length > 300) throw fail('메시지는 1~300자로 입력하세요.');
        room.messages.push({name: member.name, message, color: member.color});
        room.messages = room.messages.slice(-40);
        broadcast(room);
        break;
      }
      case '/api/answer': {
        const mission = missions[body.mission];
        const question = mission?.questions[body.step];
        if (!question || member.progress[body.mission] !== body.step) throw fail('내 진행 상태가 바뀌었어요.', 409);
        const correct = body.choice === question.answer;
        if (correct) {
          member.progress[body.mission]++;
          if (member.progress[body.mission] === mission.questions.length) {
            room.activity.push({name: member.name, color: member.color, mission: Number(body.mission), time: Date.now()});
          }
          broadcast(room);
        }
        return send(res, {correct, feedback: correct ? question.why : '단서를 다시 읽고 친구와 근거를 이야기해 보세요.'});
      }
      case '/api/leave':
        if (!member.progress.every((step, index) => step >= missions[index].questions.length)) throw fail('세 미션을 모두 해결하면 퇴장할 수 있어요.', 409);
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
