import {world, spawn, exit, characters, distance, withinWorld, traps, monsters, trapState, monsterPosition} from './world.js';
import {makeTerrain} from './terrain.js';

const $ = selector => document.querySelector(selector);
function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
const map = $('#map');
const canvas = $('#terrain');
const ctx = canvas.getContext('2d');
const mini = $('#minimap');
const miniCtx = mini.getContext('2d');
const dialog = $('#dialog');
const dialogBody = $('#dialog-body');
const keys = new Set();
const camera = {x:0,y:0,width:0,height:0};
const timeFormat = new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
const fallbackJournal = () => missions.map(() => ({notes:{},tokens:{},routes:{},done:false}));
let missions = [];
let terrain;
let session;
let stream;
let nowOffset = 0;
let falls = 0;
let shield = 0;
let local;
let target;
let acting = false;
let movement;
let movedAt = 0;
let journal = [];
let state = {players:[],messages:[],activity:[]};
let tab = 'missions';
let toastTimer;
let lastFrame = 0;
let lastMini = 0;
let markers = [];
const avatars = new Map();

function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {box.hidden = true;}, 4200);
}
async function api(path, body) {
  const result = await fetch('/api/' + path, body ? {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...session, falls, ...body})
  } : undefined);
  const data = await result.json();
  if (!result.ok) throw Object.assign(new Error(data.error),{status:result.status});
  return data;
}
function look(id) {return characters.find(character => character.id === id) ?? characters[0];}
function figure(character) {
  const art = node('div','','figure');
  for (const key of ['skin','hair','coat','trim']) art.style.setProperty('--'+key,character[key]);
  art.append(node('i','','legs'),node('i','','torso'),node('i','','head'));
  art.dataset.look = character.id;
  art.setAttribute('aria-hidden','true');
  return art;
}
function setStatus(text, connected = false) {
  $('#connection').textContent = text;
  $('#connection').classList.toggle('online',connected);
}
function openDialog(...children) {
  keys.clear();
  target = null;
  dialogBody.replaceChildren(...children);
  if (!dialog.open) dialog.showModal();
}
function entry(create) {
  if (!terrain) {toast('탐험 지도를 불러오는 중이에요.'); return;}
  const form = node('form');
  const field = (label, length) => {
    const wrapper = node('label',label);
    const input = node('input');
    Object.assign(input,{required:true,maxLength:length,autocomplete:'off'});
    wrapper.append(input);
    form.append(wrapper);
    return input;
  };
  const name = field('별명',18);
  const code = create ? null : field('입장 코드',6);
  if (code) code.placeholder = '교사가 알려 준 6자리 코드';
  const fieldset = node('fieldset');
  fieldset.append(node('legend','탐험가 선택'));
  const options = node('div','','character-grid');
  for (const [index,character] of characters.entries()) {
    const option = node('label','','character-option');
    const radio = node('input');
    Object.assign(radio,{type:'radio',name:'character',value:character.id,checked:index === 0});
    const tile = node('span','','character-tile');
    tile.append(figure(character),node('strong',character.name));
    option.append(radio,tile);
    options.append(option);
  }
  fieldset.append(options);
  const submit = node('button',create ? '방 열기' : '탐험 시작 ↗');
  const status = node('p','','error');
  status.setAttribute('role','status');
  form.append(fieldset,submit,status);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const character = new FormData(form).get('character');
      const credentials = await api(create ? 'create' : 'join',{name:name.value,code:code?.value,character});
      connect(credentials);
      dialog.close();
      if (create) toast('교실에 입장 코드를 공유하세요.');
    } catch (error) {status.textContent = error.message;}
    finally {submit.disabled = false;}
  };
  openDialog(node('div','ATLAS / 탐험대 등록','eyebrow'),node('h2',create ? '교사 · 방 만들기' : '탈출 작전 입장'),form);
}
function syncPlayers(players) {
  const current = new Set(players.map(player => player.id));
  for (const [id,avatar] of avatars) {
    if (!current.has(id)) {avatar.element.remove(); avatars.delete(id);}
  }
  for (const player of players) {
    let avatar = avatars.get(player.id);
    if (!avatar) {
      const own = player.id === session?.id;
      const element = node('div','',own ? 'avatar me' : 'avatar');
      element.dataset.id = player.id;
      element.dataset.character = player.character;
      element.append(figure(look(player.character)),node('span',player.name,'player-name'));
      $('#avatars').append(element);
      avatar = {element,own,x:player.x,y:player.y,goal:player};
      avatars.set(player.id,avatar);
    }
    avatar.goal = player;
    if (avatar.own && !local) {
      local = {x:player.x,y:player.y,face:player.face};
      map.focus();
    }
  }
}
function connect(credentials) {
  stream?.close();
  session = credentials;
  sessionStorage.setItem('atlas-room',JSON.stringify(session));
  $('#welcome').hidden = true;
  $('#panel').hidden = false;
  $('#navigator').hidden = false;
  $('#controls').hidden = false;
  $('#toggle-panel').hidden = false;
  $('#toggle-panel').setAttribute('aria-expanded','true');
  $('#room-code').textContent = '입장 코드 ' + session.code + ' ⧉';
  setStatus('연결 중');
  renderMissionSummary();
  const source = new EventSource('/api/events?' + new URLSearchParams({code:session.code,key:session.key}));
  stream = source;
  source.onopen = () => setStatus('작전 연결됨',true);
  source.onerror = () => {
    if (stream !== source) return;
    setStatus('재연결 중');
    if (source.readyState === EventSource.CLOSED) toast('방 연결이 끊겼어요. 새로고침하여 다시 시도하세요.');
  };
  source.addEventListener('clock',event => {nowOffset = Number(event.data) - Date.now();});
  source.addEventListener('life',event => {falls = Number(event.data);});
  source.addEventListener('state',event => {
    state = JSON.parse(event.data);
    syncPlayers(state.players);
    $('#player-count').textContent = state.players.length + '명 접속';
    if (tab !== 'journal' && tab !== 'missions') renderFeed();
  });
  source.addEventListener('positions',event => {
    for (const player of JSON.parse(event.data)) {
      const avatar = avatars.get(player.id);
      if (avatar) avatar.goal = player;
    }
  });
  source.addEventListener('journal',event => {
    journal = JSON.parse(event.data);
    updateMarkers();
    renderMissionSummary();
    if (tab === 'journal' || tab === 'missions') renderFeed();
  });
  source.addEventListener('respawn',event => {
    const life = JSON.parse(event.data);
    falls = life.falls;
    local = {x:life.x,y:life.y,face:1};
    shield = performance.now() + 3500;
    keys.clear();
    target = null;
    if (dialog.open) dialog.close();
    map.focus();
    toast('위험 구역에 닿았어요. 출발 기지에서 부활했습니다. 단서와 잠금을 다시 해결하세요.');
  });
  setTab(session.teacher ? 'activity' : 'missions');
}
function reset() {
  stream?.close();
  stream = undefined;
  session = undefined;
  local = undefined;
  target = null;
  falls = 0;
  shield = 0;
  keys.clear();
  state = {players:[],messages:[],activity:[]};
  journal = fallbackJournal();
  renderMissionSummary();
  syncPlayers([]);
  updateMarkers();
  sessionStorage.removeItem('atlas-room');
  $('#welcome').hidden = false;
  $('#panel').hidden = true;
  $('#toggle-panel').hidden = true;
  $('#navigator').hidden = true;
  $('#controls').hidden = true;
  $('#interact').hidden = true;
  setStatus('입장 대기');
}
function setTab(next) {
  tab = next;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active',button.dataset.tab === tab);
    button.setAttribute('aria-pressed',String(button.dataset.tab === tab));
  }
  $('#feed').scrollTop = 0;
  renderFeed();
}
function unlockedMissions() {
  return journal.filter(record => record.done).length;
}
function renderMissionSummary() {
  const completed = unlockedMissions();
  $('#mission-total').textContent = completed + ' / ' + missions.length + ' 완료';
  const lights = missions.map((mission, index) => {
    const light = node('span', '', 'mission-light');
    light.classList.toggle('lit', journal[index].done);
    light.title = mission.title + (journal[index].done ? ' · 완료' : ' · 미완료');
    return light;
  });
  $('#mission-lights').replaceChildren(...lights);
}
function missionCards() {
  return missions.map((mission, index) => {
    const record = journal[index];
    const notes = Object.keys(record.notes).length;
    const tokens = Object.keys(record.tokens).length;
    const routes = Object.keys(record.routes).length;
    const ready = tokens === mission.sites.length && routes === mission.consoles.length;
    const status = record.done ? '완료' : ready ? '금고 준비' : notes || routes || tokens ? '탐험 중' : '미완료';

    const card = node('li', '', 'mission-card');
    card.dataset.index = index;
    card.classList.toggle('complete', record.done);
    card.classList.toggle('ready', ready && !record.done);
    card.style.setProperty('--zone', mission.color);

    const heading = node('div', '', 'mission-card-heading');
    const icon = node('span', mission.icon, 'mission-icon');
    icon.setAttribute('aria-hidden', 'true');
    const title = node('div', '', 'mission-name');
    title.append(node('span', mission.region, 'mission-zone'), node('h3', mission.title));
    const badge = node('span', '', 'mission-status');
    const indicator = node('span', record.done ? '✓' : '', 'status-light');
    indicator.setAttribute('aria-hidden', 'true');
    badge.append(indicator, document.createTextNode(status));
    heading.append(icon, title, badge);

    const steps = node('ul', '', 'mission-steps');
    for (const [label, count, total] of [
      ['문서', notes, mission.sites.length], ['표식', tokens, mission.sites.length],
      ['안내판', routes, mission.consoles.length]
    ]) {
      const checked = count === total;
      const step = node('li', '', checked ? 'checked' : '');
      step.append(node('span', label), node('strong', count + '/' + total));
      if (checked) {
        const mark = node('span', '✓', 'step-check');
        mark.setAttribute('aria-hidden', 'true');
        step.append(mark);
      }
      steps.append(step);
    }
    const pendingLock = mission.sites.find(site => record.notes[site.id] && !record.tokens[site.id]);
    const missingNote = mission.sites.find(site => !record.notes[site.id]);
    let objective = '구역의 순서 안내판을 찾아 조사하세요.';
    if (record.done) objective = '게이트 표식을 확보했어요.';
    else if (ready) objective = '안내판 순서로 표식을 조합해 금고를 여세요.';
    else if (pendingLock) objective = pendingLock.name + ' 자물쇠를 풀어 표식을 얻으세요.';
    else if (missingNote) objective = missingNote.name + '의 단서 문서를 찾으세요.';
    card.append(heading, steps, node('p', objective, 'mission-objective'));
    return card;
  });
}
function missionOverview() {
  const list = node('ol', '', 'mission-list');
  list.append(...missionCards());

  const ready = unlockedMissions() === missions.length;
  const gate = node('section', '', ready ? 'gate-card ready' : 'gate-card');
  const titleRow = node('div', '', 'gate-heading');
  const title = node('h3', '최종 탈출 게이트');
  const badge = node('span', '', 'mission-status');
  const indicator = node('span', ready ? '→' : '', 'status-light');
  indicator.setAttribute('aria-hidden', 'true');
  badge.append(indicator, document.createTextNode(ready ? '도전 가능' : '잠김'));
  titleRow.append(title, badge);
  const objective = ready ? '출발 기지 남쪽 게이트에서 표식 3개로 마지막 암호를 푸세요.' : '세 구역의 금고를 열어 게이트 표식을 모으세요.';
  gate.append(titleRow, node('p', objective, 'mission-objective'));
  return [list, gate];
}
function notebook() {
  return missions.map((mission,index) => {
    const record = journal[index];
    const progress = Object.keys(record.tokens).length;
    const section = node('details','','notebook');
    section.dataset.index = index;
    const title = node('summary',mission.region + ' · ' + (record.done ? '해제 완료' : progress + '/4 표식'));
    title.style.color = mission.color;
    section.append(title);
    const clues = mission.sites.filter(site=>record.notes[site.id]);
    if (!clues.length) section.append(node('p','현장에서 단서 문서를 찾아 조사하세요.','muted'));
    for (const site of clues) section.append(node('p',site.name + ' · ' + record.notes[site.id]));
    for (const text of Object.values(record.routes)) section.append(node('p','안내판 · ' + text));
    if (record.key) section.append(node('p','게이트 표식 · '+record.key.symbol+' '+record.key.digit,'tokens'));
    const tokens = Object.values(record.tokens).sort((a,b)=>a.symbol.localeCompare(b.symbol,'ko'));
    if (tokens.length) section.append(node('p',tokens.map(({symbol,digit})=>symbol+' '+digit).join(' · '),'tokens'));
    return section;
  });
}
function renderFeed() {
  const feed = $('#feed');
  feed.setAttribute('aria-live', tab === 'activity' || tab === 'chat' ? 'polite' : 'off');
  const rows = [];
  const scrollPosition = feed.scrollTop;
  if (tab === 'missions') {
    rows.push(...missionOverview());
  } else if (tab === 'journal') {
    const open = new Set([...feed.querySelectorAll('details[open]')].map(item=>item.dataset.index));
    const completed = journal.filter(record=>record.done).length;
    const note = completed === missions.length && completed ? '세 구역 해제 완료 · 출발 기지 남쪽 탈출 게이트로 이동하세요.' :
      '문서 → 자물쇠 → 안내판 → 구역 금고';
    rows.push(node('p',note,'feed-intro'),...notebook(),node('p','노란 경고 원과 순찰 괴물을 피해 이동하세요. 닿으면 출발 기지에서 다시 시작합니다.','feed-intro'));
    for (const section of rows.filter(row=>row.tagName==='DETAILS')) section.open = open.has(section.dataset.index);
  } else if (tab === 'activity') {
    for (const item of [...state.activity].reverse()) {
      const row = node('div','','feed-row');
      const who = node('strong',item.name);
      who.style.color = item.color;
      const text = item.restart ? ' 님이 출발 기지에서 부활했어요.' : ' 님이 ' + missions[item.mission].title + ' 미션을 완료했어요.';
      row.append(who,document.createTextNode(text),node('small',timeFormat.format(item.time)));
      rows.push(row);
    }
  } else if (tab === 'chat') {
    for (const item of state.messages) {
      const row = node('div','','feed-row');
      const who = node('strong',item.name);
      who.style.color = item.color;
      row.append(who,document.createTextNode('  ' + item.message));
      rows.push(row);
    }
  } else {
    for (const player of state.players) {
      const character = look(player.character);
      const row = node('div','','feed-row team');
      row.append(figure(character),node('strong',player.name + (player.teacher ? ' · 교사' : '') + (player.id === session?.id ? ' · 나' : '')));
      rows.push(row);
    }
  }
  const blank = {activity:'탐험대가 미션을 완료하면 여기에 표시돼요.',chat:'단서를 찾으면 탐험대와 공유해 보세요.',players:'접속한 탐험대가 여기에 표시돼요.'};
  feed.replaceChildren(...(rows.length ? rows : [node('p',blank[tab],'feed-intro')]));
  feed.scrollTop = tab === 'chat' ? feed.scrollHeight : scrollPosition;
  $('#chat').hidden = tab !== 'chat' || !session;
}
function setupMarkers() {
  const glyphs = {vault:'◆',note:'▤',site:'▣',route:'↝',exit:'⇥'};
  function marker(point,kind,label,index,site,fragment) {
    const button = node('button','','marker '+kind);
    button.append(node('b',glyphs[kind]),node('span',label));
    button.setAttribute('aria-label',label);
    const item = {...point,kind,label,index,site,fragment,button,glyph:glyphs[kind]};
    button.onclick = () => approach(item);
    if (missions[index]) button.style.setProperty('--zone',missions[index].color);
    markers.push(item);
    $('#markers').append(button);
  }
  for (const [index,mission] of missions.entries()) {
    marker(mission,'vault',mission.title,index);
    mission.consoles.forEach((point,fragment) => marker(point,'route',mission.region+' · 순서 안내판 '+(fragment+1),index,undefined,fragment));
    for (const site of mission.sites) {
      marker(site,'site',site.name,index,site);
      marker(site.note,'note','단서 문서 · '+site.name,index,site);
    }
  }
  marker(exit,'exit','탈출 게이트');
}
function updateMarkers() {
  for (const item of markers) {
    const {kind,index,site,button} = item;
    const record = journal[index];
    const isComplete = kind === 'vault' ? record?.done : kind === 'site' ? record?.tokens[site.id] :
      kind === 'note' ? record?.notes[site.id] : kind === 'route' ? record?.routes[item.fragment] : journal.length && journal.every(entry=>entry.done);
    const done = Boolean(isComplete) && kind !== 'exit';
    button.classList.toggle('done',done);
    button.classList.toggle('gate-ready',Boolean(isComplete) && kind === 'exit');
    button.firstElementChild.textContent = done ? '✓' : item.glyph;
  }
}
function approach(item) {
  if (!session) {entry(false); return;}
  if (!local || acting) return;
  keys.clear();
  if (distance(local,item) <= world.reach*.85) interact(item);
  else {target = item; map.focus();}
}
function submission(placeholder, handler, maxLength=40, digits=false) {
  const form = node('form');
  const input = node('input');
  Object.assign(input,{placeholder,autocomplete:'off',maxLength,required:true});
  input.setAttribute('aria-label',placeholder);
  if (digits) input.inputMode = 'numeric';
  const submit = node('button','자물쇠 열기 ↗');
  const feedback = node('div','','feedback');
  feedback.setAttribute('role','status');
  form.append(input,submit,feedback);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    const life = falls;
    try {
      const result = await handler(input.value);
      if (falls !== life || !dialogBody.contains(form)) return;
      feedback.textContent = result.message;
      if (result.correct) {
        const close = node('button','지도 돌아가기 ↗');
        close.type = 'button';
        close.onclick = () => dialog.close();
        input.replaceWith(close);
        submit.remove();
        close.focus();
        return;
      }
    } catch(error) {feedback.textContent = error.message;}
    submit.disabled = false;
  };
  return form;
}
async function interact(item) {
  if (!local || acting || distance(local,item)>world.reach) return;
  target = null;
  acting = true;
  keys.clear();
  const life = falls;
  const mission = missions[item.index];
  const meta = node('div',mission?.region ?? '출발 기지 남단','eyebrow');
  const title = node('h2',item.label);
  try {
    await flushMove();
    if (falls !== life) return;
    if (item.kind === 'exit') {
      if (!journal.every(entry=>entry.done)) {
        openDialog(meta,title,node('p','세 구역의 금고를 모두 열어야 탈출 게이트가 열려요.'));
        return;
      }
      const gate = await api('gate',{});
      const symbols = journal.map(entry=>entry.key).sort((a,b)=>a.symbol.localeCompare(b.symbol,'ko'));
      const form = submission('숫자 세 자리',async answer=>{
        const result = await api('leave',{answer});
        if (!result.ok) return {correct:false,message:result.feedback};
        reset();
        if (document.fullscreenElement) await document.exitFullscreen().catch(()=>{});
        openDialog(node('div','ATLAS / 작전 완료','eyebrow'),node('h2','탈출 성공!'),node('p','세 구역의 잠금을 모두 해제하고 기지를 빠져나왔어요.'));
        return {correct:true,message:'탈출 성공!'};
      },3,true);
      openDialog(meta,title,node('p',gate.clue),node('p',gate.legend,'muted'),
        node('p',symbols.map(key=>key.symbol+' '+key.digit).join(' · '),'tokens'),form);
      return;
    }
    const record = journal[item.index];
    if (item.kind === 'vault') {
      if (record.done) {openDialog(meta,title,node('p','◆ 이 금고를 이미 해제했어요.')); return;}
      const contents = [meta,title,node('p',mission.story)];
      if (Object.keys(record.tokens).length === mission.sites.length && Object.keys(record.routes).length === mission.consoles.length) {
        contents.push(...Object.values(record.routes).map(text=>node('p',text)),
          node('p',Object.values(record.tokens).sort((a,b)=>a.symbol.localeCompare(b.symbol,'ko')).map(t=>t.symbol+' '+t.digit).join(' · '),'tokens'),
          submission('숫자 네 자리',async answer => {
            const result = await api('unlock',{mission:item.index,answer});
            return {correct:result.correct,message:result.correct ? '금고 해제! 게이트 표식 '+result.key.symbol+' '+result.key.digit+'를 얻었어요.' : result.feedback};
          },4,true));
      } else contents.push(node('p','현장 표식 '+Object.keys(record.tokens).length+'/4 · 순서 안내판 '+Object.keys(record.routes).length+'/2','tokens'));
      openDialog(...contents);
      return;
    }
    const data = await api('inspect',{mission:item.index,kind:item.kind,site:item.site?.id,fragment:item.fragment});
    if (falls !== life) return;
    if (item.kind === 'note' || item.kind === 'route') {
      openDialog(meta,title,node('p',data.clue ?? data.text),node('p',data.legend ?? '단서가 탐험 수첩에 기록됐어요.','tokens'));
      return;
    }
    const token = record.tokens[item.site.id];
    if (token) {
      openDialog(meta,title,node('p','획득한 표식 · '+token.symbol+' '+token.digit,'tokens'));
      return;
    }
    const clue = record.notes[item.site.id];
    if (!clue) {
      openDialog(meta,title,node('p',data.prompt),node('p','지도에서 이 자물쇠와 같은 이름의 단서 문서를 먼저 찾아 조사하세요.','tokens'));
      return;
    }
    openDialog(node('div',item.site.kind,'eyebrow'),title,node('p',data.prompt),node('p','수첩 단서 · '+clue,'muted'),
      submission('정답 입력',async answer => {
        const result = await api('answer',{mission:item.index,site:item.site.id,answer});
        return {correct:result.correct,message:result.correct ? '표식 '+result.found.symbol+' '+result.found.digit+' 획득! '+result.feedback : result.feedback};
      }));
  } catch(error) {if (falls === life) toast(error.message);}
  finally {acting = false;}
}

const directions = {arrowup:[0,-1],w:[0,-1],arrowdown:[0,1],s:[0,1],arrowleft:[-1,0],a:[-1,0],arrowright:[1,0],d:[1,0]};
async function flushMove() {
  if (movement) await movement;
  if (!local || !session) return;
  const point = {...local};
  const life = falls;
  movedAt = performance.now();
  const action = api('move',point);
  movement = action;
  try {
    const result = await action;
    if (result.falls === life && falls === life && distance(point,result)>1) Object.assign(local,result);
  } finally {if (movement === action) movement = null;}
}
function advance(dt,timestamp) {
  if (!local || acting || dialog.open) return false;
  let dx = 0, dy = 0;
  for (const key of keys) {dx += directions[key][0]; dy += directions[key][1];}
  if (dx || dy) target = null;
  if (target) {
    dx = target.x-local.x;
    dy = target.y-local.y;
  }
  const length = Math.hypot(dx,dy);
  if (target && length < (target.kind ? 65 : 8)) {
    const arrived = target;
    target = null;
    if (arrived.kind) interact(arrived);
    return false;
  }
  if (!length) {
    if (local.unsynced && !movement) sendMovement();
    return false;
  }
  const step = Math.min(target ? length : Infinity,dt*world.speed);
  const position = withinWorld({x:local.x+dx/length*step,y:local.y+dy/length*step});
  if (distance(local,position) < .01) return false;
  Object.assign(local,position);
  if (Math.abs(dx)>Math.abs(dy)*.4) local.face = dx < 0 ? -1 : 1;
  local.unsynced = true;
  if (timestamp-movedAt>=120 && !movement) sendMovement();
  return true;
}
function sendMovement() {
  local.unsynced = false;
  const life = falls;
  flushMove().catch(error => {
    if (session && falls === life) {
      target = null;
      keys.clear();
      const own = avatars.get(session.id);
      if (own) Object.assign(local,own.goal);
      toast(error.message);
    }
  });
}
function resize() {
  const ratio = Math.min(1.5,window.devicePixelRatio || 1);
  const width = map.clientWidth;
  const height = map.clientHeight;
  const zoom = Math.max(width < 690 ? .82 : 1, width/world.width, height/world.height);
  canvas.width = Math.round(width*ratio);
  canvas.height = Math.round(height*ratio);
  ctx.setTransform(ratio*zoom,0,0,ratio*zoom,0,0);
  camera.width = width/zoom;
  camera.height = height/zoom;
  camera.zoom = zoom;
}
function setCamera() {
  const point = local ?? spawn;
  camera.x = Math.max(0,Math.min(world.width-camera.width,point.x-camera.width/2));
  camera.y = Math.max(0,Math.min(world.height-camera.height,point.y-camera.height*.56));
}
function screen(point) {
  return {x:(point.x-camera.x)*camera.zoom,y:(point.y-camera.y)*camera.zoom};
}
function setPosition(element,point) {
  const {x,y} = screen(point);
  element.style.transform = 'translate3d('+Math.round(x)+'px,'+Math.round(y)+'px,0)';
}
function visible(point) {
  return point.x>camera.x-130 && point.y>camera.y-100 && point.x<camera.x+camera.width+130 && point.y<camera.y+camera.height+100;
}
function drawDanger(now) {
  for (const trap of traps) {
    if (!visible(trap)) continue;
    const type = trapState(trap,now);
    const x = trap.x-camera.x, y = trap.y-camera.y;
    ctx.fillStyle = type === 'active' ? '#e85a4977' : type === 'warning' ? '#f9c96d45' : '#293a36ad';
    ctx.strokeStyle = type === 'active' ? '#ff8674' : type === 'warning' ? '#fbe293' : '#87978588';
    ctx.lineWidth = 2;
    ctx.beginPath();ctx.arc(x,y,49,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = 'bold 22px monospace';ctx.textAlign='center';
    ctx.fillText(type === 'active' ? '×' : '!',x,y+8);
  }
  for (const monster of monsters) {
    const point = monsterPosition(monster,now);
    if (!visible(point)) continue;
    const x = point.x-camera.x, y = point.y-camera.y;
    ctx.fillStyle='#101e2390';
    ctx.beginPath();ctx.ellipse(x,y+11,31,15,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#ff926c';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(x,y,32,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#352d43';
    ctx.beginPath();ctx.moveTo(x-27,y+4);ctx.lineTo(x-24,y-24);ctx.lineTo(x-13,y-17);
    ctx.quadraticCurveTo(x,y-24,x+13,y-17);ctx.lineTo(x+24,y-24);ctx.lineTo(x+27,y+4);
    ctx.quadraticCurveTo(x+17,y+23,x,y+13);ctx.quadraticCurveTo(x-17,y+23,x-27,y+4);ctx.fill();
    ctx.fillStyle='#ffbb84';ctx.fillRect(x-13,y-7,7,4);ctx.fillRect(x+6,y-7,7,4);
  }
}
function drawMini() {
  const {width,height} = mini;
  miniCtx.drawImage(terrain,0,0,width,height);
  const sx=width/world.width, sy=height/world.height;
  miniCtx.strokeStyle='#efede396';
  miniCtx.strokeRect(camera.x*sx,camera.y*sy,camera.width*sx,camera.height*sy);
  for (const point of markers) {
    const special = point.kind==='vault' || point.kind==='exit';
    if (point.kind==='note' && local && distance(local,point)>620 && !point.button.classList.contains('done')) continue;
    miniCtx.fillStyle = special ? (missions[point.index]?.color ?? '#adffd1') : point.button.classList.contains('done') ? '#b8e6b773' : '#f5e8c198';
    const radius = special ? 3 : 1;
    miniCtx.fillRect(point.x*sx-radius,point.y*sy-radius,radius*2,radius*2);
  }
  for (const avatar of avatars.values()) {
    if (avatar.own) continue;
    miniCtx.fillStyle='#ade5a9a0';
    miniCtx.fillRect(avatar.x*sx-1,avatar.y*sy-1,2,2);
  }
  if (local) {
    miniCtx.fillStyle='#fff';
    miniCtx.beginPath();miniCtx.arc(local.x*sx,local.y*sy,3.5,0,Math.PI*2);miniCtx.fill();
  }
}
function frame(timestamp) {
  const dt = Math.min(.05,(timestamp-lastFrame)/1000);
  lastFrame = timestamp;
  const walking = advance(dt,timestamp);
  setCamera();
  ctx.fillStyle='#26383a';
  ctx.fillRect(0,0,camera.width,camera.height);
  ctx.drawImage(terrain,-Math.round(camera.x),-Math.round(camera.y));
  drawDanger(Date.now()+nowOffset);
  let nearest;
  for (const point of markers) {
    const show = visible(point);
    point.button.hidden = !show;
    if (!show) continue;
    setPosition(point.button,point);
    const meters = local ? distance(local,point) : Infinity;
    point.button.classList.toggle('near',meters<=world.reach);
    if (meters<=world.reach && (!nearest || meters<distance(local,nearest))) nearest=point;
  }
  for (const avatar of avatars.values()) {
    const {element,own,goal} = avatar;
    const gap = distance(avatar,goal);
    if (!own && gap>550) {avatar.x=goal.x;avatar.y=goal.y;}
    const remoteWalking = gap>1.5 && gap<=550;
    if (!own && remoteWalking) {
      const fraction = Math.min(1,dt*13);
      avatar.x += (goal.x-avatar.x)*fraction;
      avatar.y += (goal.y-avatar.y)*fraction;
    }
    const point = own && local ? local : avatar;
    element.hidden = !visible(point);
    if (element.hidden) continue;
    setPosition(element,point);
    element.style.setProperty('--face',own && local ? local.face : goal.face);
    element.style.zIndex = Math.floor(point.y);
    element.classList.toggle('walking',own ? walking : remoteWalking);
    element.classList.toggle('shielded',own && timestamp<shield);
  }
  const action = $('#interact');
  action.hidden = !nearest || !session || dialog.open;
  action.onclick = nearest ? ()=>interact(nearest) : null;
  if (nearest) {
    const label = 'E · '+nearest.label;
    if (action.textContent!==label) action.textContent=label;
  }
  if (timestamp-lastMini>110 && session) {drawMini();lastMini=timestamp;}
  requestAnimationFrame(frame);
}
map.onclick = event => {
  if (event.target.closest('button')) return;
  if (!session) {entry(false);return;}
  if (!local || acting) return;
  keys.clear();
  target = withinWorld({x:camera.x+event.clientX/camera.zoom,y:camera.y+event.clientY/camera.zoom});
  map.focus();
};
document.addEventListener('keydown',event => {
  if (!local || dialog.open || event.target.closest('input,textarea,button,summary') || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (Object.hasOwn(directions,key)) {event.preventDefault();keys.add(key);}
  if (key==='e' && !event.repeat && !$('#interact').hidden) $('#interact').click();
});
document.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
window.addEventListener('blur',()=>{keys.clear();target=null;});
window.addEventListener('resize',resize);
window.addEventListener('pagehide',()=>stream?.close());
window.addEventListener('pageshow',event=>{if (event.persisted && session) {local=undefined;connect(session);}});
window.addEventListener('beforeunload',event=>{
  if (session && !session.teacher && journal.some(entry=>!entry.done)) {event.preventDefault();event.returnValue=true;}
});
dialog.addEventListener('close',()=>{if(session) map.focus();});
$('#close').onclick = ()=>dialog.close();
$('#join').onclick = ()=>entry(false);
$('#create').onclick = ()=>entry(true);
$('#fullscreen').onclick = async ()=>{
  try {if(document.fullscreenElement) await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch {toast('이 브라우저에서 전체화면을 열 수 없어요.');}
  if (session) map.focus();
};
$('#toggle-panel').onclick = ()=>{
  if (!session) return;
  const panel = $('#panel');
  panel.hidden = !panel.hidden;
  $('#toggle-panel').setAttribute('aria-expanded',String(!panel.hidden));
  map.focus();
};
$('#room-code').onclick = async ()=>{
  try {await navigator.clipboard.writeText(session.code);toast('입장 코드를 복사했어요.');}
  catch {toast('입장 코드 '+session.code);}
};
for (const button of document.querySelectorAll('[data-tab]')) button.onclick=()=>setTab(button.dataset.tab);
$('#chat').onsubmit = async event=>{
  event.preventDefault();
  const input=event.currentTarget.querySelector('input');
  const message=input.value;
  if (!message.trim()) return;
  try {await api('chat',{message});if(input.value===message) input.value='';}
  catch(error) {toast(error.message);}
};
try {
  missions = await api('missions');
  journal = fallbackJournal();
  terrain = makeTerrain(missions);
  setupMarkers();
  resize();
  requestAnimationFrame(frame);
  const saved = sessionStorage.getItem('atlas-room');
  if (saved) {
    const credentials = JSON.parse(saved);
    const resumed = await api('resume',credentials);
    falls = resumed.falls;
    connect(credentials);
  }
} catch(error) {
  if (error.status===401 || error.status===404) reset();
  toast(error.message);
}
