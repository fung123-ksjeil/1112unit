const $ = selector => document.querySelector(selector);
const node = (tag, text = '', className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};
const dialog = $('#dialog');
const dialogBody = $('#dialog-body');
const map = $('#map');
let missions = [];
let session;
let events;
let state = {players: [], activity: [], messages: []};
let tab = 'activity';
let toastTimer;
let pendingMove;
let moveTimer;
let activeMission = null;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}
async function api(path, body) {
  const response = await fetch('/api/' + path, body ? {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...session, ...body})
  } : undefined);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), {status: response.status});
  return data;
}
function myPlayer() { return state.players.find(player => player.id === session?.id); }
function myProgress() { return myPlayer()?.progress ?? [0, 0, 0]; }
function renderStatus(online) {
  $('#connection').replaceChildren(node('i'), document.createTextNode(online ? ' 연결됨' : session ? ' 재연결 중' : ' 입장 대기'));
}
function place(element, x, y) {
  element.style.left = x + '%';
  element.style.top = y + '%';
}
function renderWorld() {
  const avatars = $('#avatars');
  const online = new Set(state.players.map(player => player.id));
  for (const avatar of avatars.children) if (!online.has(avatar.dataset.id)) avatar.hidden = true;
  for (const avatar of [...avatars.children]) if (avatar.hidden) avatar.remove();
  for (const player of state.players) {
    let avatar = [...avatars.children].find(item => item.dataset.id === player.id);
    if (!avatar) {
      avatar = node('div', '', player.id === session?.id ? 'avatar me' : 'avatar');
      avatar.dataset.id = player.id;
      const head = node('b');
      head.style.background = player.color;
      avatar.append(head, node('span', player.name));
      avatars.append(avatar);
    }
    place(avatar, player.x, player.y);
  }
  $('#player-count').textContent = state.players.length + '명 접속 중';
}
function renderMissions() {
  const progress = myProgress();
  let completed = 0;
  missions.forEach((mission, index) => {
    const done = progress[index] === mission.questions.length;
    if (done) completed++;
    const marker = $('#markers').children[index];
    marker.classList.toggle('done', done);
    marker.firstChild.textContent = done ? '✓' : mission.icon;
    $('#mission-list').children[index].lastChild.textContent = done ? '완료' : progress[index] + '/' + mission.questions.length;
  });
  $('#progress').textContent = completed + ' / ' + missions.length;
  $('#leave').hidden = !(session && missions.length && completed === missions.length);
}
function renderFeed() {
  const feed = $('#feed');
  const rows = [];
  if (tab === 'activity') {
    for (const item of [...state.activity].reverse()) {
      const row = node('div', '', 'feed-row');
      const who = node('strong', item.name);
      who.style.color = item.color;
      row.append(who, document.createTextNode(' 님이 ' + missions[item.mission].title + ' 미션을 완료했어요.'),
        node('small', new Intl.DateTimeFormat('ko-KR', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Seoul'}).format(item.time)));
      rows.push(row);
    }
  } else if (tab === 'chat') {
    for (const item of state.messages) {
      const row = node('div', '', 'feed-row');
      const who = node('strong', item.name);
      who.style.color = item.color;
      row.append(who, document.createTextNode('  ' + item.message));
      rows.push(row);
    }
  } else {
    for (const player of state.players) {
      const row = node('div', '', 'feed-row');
      const label = node('strong', player.name + (player.teacher ? ' · 교사' : '') + (player.id === session?.id ? ' · 나' : ''));
      label.style.color = player.color;
      row.append(label);
      rows.push(row);
    }
  }
  const blank = {activity: '미션을 완료하면 여기에 표시돼요.', chat: '미션의 단서와 풀이 근거를 친구와 나눠 보세요.', players: '입장하면 함께 있는 탐험대가 보여요.'};
  feed.replaceChildren(...(rows.length ? rows : [node('p', blank[tab], 'empty')]));
  if (tab === 'chat') feed.scrollTop = feed.scrollHeight;
  $('#chat').hidden = tab !== 'chat' || !session;
}
function connect(credentials) {
  events?.close();
  session = credentials;
  sessionStorage.setItem('atlas-room', JSON.stringify(session));
  $('#join').hidden = true;
  $('#create').hidden = true;
  $('#room-code').hidden = false;
  $('#room-code').textContent = '입장 코드 ' + session.code + ' ⧉';
  $('#map-hint').textContent = '⌁ 지도의 미션 지점을 선택하세요';
  renderStatus(false);
  renderFeed();
  events = new EventSource('/api/events?' + new URLSearchParams({code: session.code, key: session.key}));
  events.onopen = () => renderStatus(true);
  events.onerror = () => {
    renderStatus(false);
    if (events.readyState === EventSource.CLOSED) {
      toast('방 연결이 끊겼어요. 새로고침하여 다시 시도해 주세요.');
    }
  };
  events.addEventListener('state', event => {
    const next = JSON.parse(event.data);
    const refreshFeed = JSON.stringify([state.activity, state.messages, state.players.map(p => p.id)]) !==
      JSON.stringify([next.activity, next.messages, next.players.map(p => p.id)]);
    state = next;
    renderWorld();
    renderMissions();
    if (refreshFeed) renderFeed();
  });
}
function reset() {
  events?.close();
  session = null;
  pendingMove = null;
  clearTimeout(moveTimer);
  moveTimer = null;
  sessionStorage.removeItem('atlas-room');
  state = {players: [], activity: [], messages: []};
  $('#join').hidden = false;
  $('#create').hidden = false;
  $('#room-code').hidden = true;
  $('#map-hint').textContent = '⌁ 지도에서 미션 위치를 확인하세요';
  renderStatus(false);
  renderWorld();
  renderMissions();
  renderFeed();
}
function openDialog(...children) {
  dialogBody.replaceChildren(...children);
  if (!dialog.open) dialog.showModal();
}
function entry(create) {
  activeMission = null;
  const form = node('form');
  function field(label, length, placeholder) {
    const group = node('label', label);
    const input = node('input');
    Object.assign(input, {required: true, maxLength: length, placeholder, autocomplete: 'off'});
    group.append(input);
    form.append(group);
    return input;
  }
  const name = field('별명', 18, create ? '예: 지리 선생님' : '예: 바다탐험가');
  const code = create ? null : field('입장 코드', 6, '6자리 코드');
  const submit = node('button', create ? '방 열기' : '입장하기');
  const status = node('div', '', 'error');
  status.setAttribute('role', 'status');
  form.append(submit, status);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const result = await api(create ? 'create' : 'join', {name: name.value, code: code?.value});
      connect(result);
      dialog.close();
      toast(create ? '방을 열었어요. 입장 코드를 학생에게 알려주세요.' : '탐험실에 입장했어요.');
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  };
  openDialog(node('h2', create ? '교사 · 방 만들기' : '탐험실 입장'), node('p', create ? '학생 최대 49명에게 같은 입장 코드를 공유하세요.' : '교사가 알려준 입장 코드와 내 별명을 입력하세요.'), form);
}
function showMission(index) {
  const mission = missions[index];
  activeMission = index;
  const step = myProgress()[index];
  const question = mission.questions[step];
  const meta = node('div', mission.topic + ' · ' + mission.pages, 'eyebrow');
  const title = node('h2', mission.title);
  const clue = node('p', '단서 · ' + mission.clue);
  if (!session) {
    const join = node('button', '코드로 입장');
    join.onclick = () => entry(false);
    openDialog(meta, title, clue, join);
    return;
  }
  if (!question) {
    openDialog(meta, title, node('p', '✓ 미션을 완료했어요.'));
    return;
  }
  const options = node('div', '', 'choices');
  const feedback = node('div', '', 'feedback');
  feedback.setAttribute('role', 'status');
  question.options.forEach((option, choice) => {
    const button = node('button', option, 'subtle');
    button.onclick = async () => {
      for (const item of options.children) item.disabled = true;
      try {
        const result = await api('answer', {mission: index, step, choice});
        if (!dialog.open || activeMission !== index || !dialogBody.contains(options)) return;
        feedback.textContent = result.feedback;
        if (result.correct) {
          if (myPlayer()) myPlayer().progress[index] = Math.max(myProgress()[index], step + 1);
          renderMissions();
          const done = step + 1 === mission.questions.length;
          const next = node('button', done ? '지도 돌아가기' : '다음 문제 ↗');
          next.onclick = done ? () => dialog.close() : () => showMission(index);
          options.replaceChildren(next);
          next.focus();
          return;
        }
      } catch (error) { feedback.textContent = error.message; }
      for (const item of options.children) item.disabled = false;
    };
    options.append(button);
  });
  openDialog(meta, title, clue, node('h3', (step + 1) + '. ' + question.q), options, feedback);
}
function installMarkers() {
  missions.forEach((mission, index) => {
    const marker = node('button', '', 'marker');
    marker.append(node('b', mission.icon), node('span', mission.title));
    place(marker, mission.x, mission.y);
    marker.onclick = () => showMission(index);
    $('#markers').append(marker);
    const item = node('button', '', 'mission');
    const label = node('div');
    label.append(node('strong', mission.title), node('small', mission.topic));
    item.append(node('i', mission.icon), label, node('em'));
    item.onclick = () => showMission(index);
    $('#mission-list').append(item);
  });
}
function move(x, y) {
  if (!myPlayer()) return;
  pendingMove = {x: Math.max(4, Math.min(96, x)), y: Math.max(12, Math.min(93, y))};
  if (moveTimer) return;
  moveTimer = setTimeout(() => {
    const target = pendingMove;
    pendingMove = null;
    moveTimer = null;
    if (session && target) api('move', target).catch(error => toast(error.message));
  }, 65);
}
map.onclick = event => {
  if (event.target.closest('button')) return;
  if (!session) { entry(false); return; }
  const bounds = map.getBoundingClientRect();
  move((event.clientX - bounds.left) / bounds.width * 100, (event.clientY - bounds.top) / bounds.height * 100);
  map.focus();
};
document.addEventListener('keydown', event => {
  const player = pendingMove || myPlayer();
  if (!player || dialog.open || event.target.closest('input,button,textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  const delta = {arrowup:[0,-3], w:[0,-3], arrowdown:[0,3], s:[0,3], arrowleft:[-3,0], a:[-3,0], arrowright:[3,0], d:[3,0]}[event.key.toLowerCase()];
  if (delta) { event.preventDefault(); move(player.x + delta[0], player.y + delta[1]); }
});
window.addEventListener('pagehide', () => events?.close());
window.addEventListener('pageshow', event => {
  if (event.persisted && session) connect(session);
});
window.addEventListener('beforeunload', event => {
  if (session && !session.teacher && myPlayer() && missions.some((mission, index) => myProgress()[index] < mission.questions.length)) {
    event.preventDefault();
    event.returnValue = true;
  }
});
$('#close').onclick = () => dialog.close();
$('#join').onclick = () => entry(false);
$('#create').onclick = () => entry(true);
$('#room-code').onclick = async () => {
  try { await navigator.clipboard.writeText(session.code); toast('입장 코드를 복사했어요.'); }
  catch { toast('입장 코드 ' + session.code); }
};
$('#fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('이 브라우저에서 전체화면을 열 수 없어요.'); }
};
$('#leave').onclick = async () => {
  try {
    await api('leave', {});
    reset();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    openDialog(node('h2', '탐험 완료!'), node('p', '세 미션을 모두 해결해 기지에서 탈출했어요. 이제 창을 닫아도 돼요.'));
  } catch (error) { toast(error.message); }
};
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  tab = button.dataset.tab;
  for (const other of document.querySelectorAll('[data-tab]')) {
    other.classList.toggle('active', other === button);
    other.setAttribute('aria-pressed', String(other === button));
  }
  renderFeed();
};
$('#chat').onsubmit = async event => {
  event.preventDefault();
  const input = event.currentTarget.querySelector('input');
  const message = input.value;
  if (!message.trim()) return;
  try { await api('chat', {message}); if (input.value === message) input.value = ''; }
  catch (error) { toast(error.message); }
};

function drawTerrain() {
  const canvas = $('#terrain');
  const ctx = canvas.getContext('2d');
  const {width, height} = canvas;
  const water = ctx.createLinearGradient(0, 0, width, height);
  water.addColorStop(0, '#142c37');
  water.addColorStop(.6, '#155047');
  water.addColorStop(1, '#122a35');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);
  function poly(points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([x,y], index) => index ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  ctx.lineWidth = 1;
  for (let x = -800; x < 1700; x += 39) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 800, 760);
    ctx.moveTo(x + 800, 0); ctx.lineTo(x, 760); ctx.strokeStyle='#80e6d420'; ctx.stroke();
  }
  const island = [[100,367],[152,295],[219,275],[260,229],[335,231],[388,159],[505,140],[550,92],[644,100],[700,155],[786,172],[806,239],[904,242],[932,309],[1020,352],[1056,426],[1005,498],[930,521],[864,592],[773,601],[738,660],[629,662],[549,708],[441,665],[352,669],[290,611],[215,596],[179,530],[106,495],[65,429]];
  const land = ctx.createLinearGradient(0, 120, 900, 670);
  land.addColorStop(0,'#5d9c71'); land.addColorStop(.55,'#386955'); land.addColorStop(1,'#50906d');
  for (const y of [43,34,23,12]) poly(island.map(([x,z]) => [x,z+y]), y === 43 ? '#122f32' : '#2b554c', '#477a69');
  poly(island, land, '#92ba88');
  ctx.save();
  ctx.clip();
  let seed = 58;
  const random = () => {seed = (seed * 16807) % 2147483647; return seed / 2147483647;};
  for (let i = 0; i < 2300; i++) {
    const x = random()*width, y=random()*height, r=random()*42+4;
    poly([[x-r,y],[x,y-r*.45],[x+r,y],[x,y+r*.45]], i%2 ? '#caf9aa0c' : '#0d3c3b15');
  }
  ctx.lineWidth = 2;
  for (let i=0; i<13; i++) {
    ctx.beginPath();
    ctx.ellipse(422,262,36+i*20,13+i*13,-.32,0,7);
    ctx.strokeStyle='#c0e4a32b'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(817,499,28+i*14,12+i*10,.32,0,7); ctx.stroke();
  }
  const route = [[285,463],[383,496],[491,425],[591,454],[707,439],[876,448]];
  const path = points => {
    ctx.beginPath();
    points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.lineWidth=13; ctx.strokeStyle='#203f38'; ctx.stroke();
    ctx.lineWidth=2; ctx.setLineDash([7,9]); ctx.strokeStyle='#c6e4a8'; ctx.stroke(); ctx.setLineDash([]);
  };
  path(route); path([[588,190],[548,287],[599,348],[591,454],[548,566],[568,624]]);
  for (let i=0; i<100; i++) {
    const x = random()*950+70, y=random()*580+90;
    if ([...route,[588,190],[548,287],[599,348],[548,566]].some(([a,b]) => Math.hypot(x-a,y-b) < 47)) continue;
    const h=12+random()*20;
    poly([[x-11,y+4],[x+4,y-3],[x+15,y+5],[x,y+11]], '#24473c');
    poly([[x-9,y],[x,y-h],[x+9,y]], '#244f42');
    poly([[x,y-h],[x+9,y],[x,y+4]], '#326a53');
  }
  for (const [x,y] of [[588,190],[285,463],[876,448],[568,624]]) {
    poly([[x-57,y],[x,y-28],[x+57,y],[x,y+33]], '#315f54', '#9ac2a1');
    poly([[x-42,y],[x,y-20],[x+42,y],[x,y+22]], '#284d47', '#a4e8bf');
  }
  ctx.restore();
}
drawTerrain();
try {
  missions = await api('missions');
  installMarkers();
  renderMissions();
  renderFeed();
  const saved = sessionStorage.getItem('atlas-room');
  if (saved) {
    const credentials = JSON.parse(saved);
    try {
      await api('resume', credentials);
      connect(credentials);
    } catch (error) {
      if (error.status === 401 || error.status === 404) reset();
      toast(error.message);
    }
  }
} catch (error) { toast(error.message); }
