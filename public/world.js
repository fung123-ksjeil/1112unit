export const world = {width: 3600, height: 2600, speed: 275, reach: 115};
export const spawn = {x: 1800, y: 2180};
export const exit = {x: 1800, y: 2350};
export const characters = [
  {id:'mint', name:'솔', skin:'#ffd0a2', hair:'#253330', coat:'#65d6a6', trim:'#f6d587'},
  {id:'sun', name:'해나', skin:'#c98e64', hair:'#352920', coat:'#eea857', trim:'#ffe0a6'},
  {id:'wave', name:'마루', skin:'#e8ae86', hair:'#202e47', coat:'#7baaf5', trim:'#b9efff'},
  {id:'star', name:'별', skin:'#a96749', hair:'#3c2440', coat:'#c1a1ed', trim:'#ffadb8'},
  {id:'berry', name:'다온', skin:'#f2c29f', hair:'#743e31', coat:'#f27a89', trim:'#fed0a1'},
  {id:'moss', name:'산', skin:'#d6a77e', hair:'#344a37', coat:'#a9b966', trim:'#e2ebaa'}
];
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function withinWorld({x,y}) {
  return {x: Math.max(28, Math.min(world.width - 28, x)), y: Math.max(28, Math.min(world.height - 28, y))};
}

export const traps = [
  {x:1450,y:1790,phase:0}, {x:620,y:1180,phase:2400}, {x:790,y:1970,phase:1200},
  {x:2390,y:1820,phase:1400}, {x:3030,y:1270,phase:700}, {x:3160,y:1865,phase:3500},
  {x:1630,y:790,phase:3000}, {x:2160,y:1060,phase:1800}, {x:1830,y:365,phase:3900}
];
export const monsters = [
  {x:727,y:1452,rx:114,ry:72,period:7800,phase:0},
  {x:2940,y:1710,rx:156,ry:81,period:8400,phase:1900},
  {x:1880,y:704,rx:182,ry:59,period:9700,phase:800}
];
export function trapState(trap, now) {
  const cycle = (now + trap.phase) % 5700;
  return cycle < 1400 ? 'warning' : cycle < 2900 ? 'active' : 'idle';
}
export function monsterPosition(monster, now) {
  const angle = (now + monster.phase) % monster.period / monster.period * Math.PI * 2;
  return {x:monster.x + Math.cos(angle)*monster.rx, y:monster.y + Math.sin(angle)*monster.ry};
}
export function dangerAt(point, now) {
  return traps.some(trap => trapState(trap, now) === 'active' && distance(point, trap) < 49) ||
    monsters.some(monster => distance(point, monsterPosition(monster, now)) < 32);
}
