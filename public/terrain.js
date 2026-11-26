import {world, spawn, exit} from './world.js';

export function makeTerrain(missions) {
  const surface = document.createElement('canvas');
  surface.width = world.width;
  surface.height = world.height;
  const g = surface.getContext('2d');
  let seed = 42;
  const rng = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const disc = (x,y,rx,ry,color) => {
    g.fillStyle=color; g.beginPath(); g.ellipse(x,y,rx,ry,0,0,Math.PI*2); g.fill();
  };
  function path(points, color, width, dash = []) {
    g.beginPath();
    points.forEach(([x,y], i) => i ? g.lineTo(x,y) : g.moveTo(x,y));
    g.strokeStyle=color; g.lineWidth=width; g.lineCap='round'; g.lineJoin='round';
    g.setLineDash(dash); g.stroke(); g.setLineDash([]);
  }
  function region(points, color, border, width = 8) {
    g.beginPath();
    points.forEach(([x,y], i) => i ? g.lineTo(x,y) : g.moveTo(x,y));
    g.closePath(); g.fillStyle=color; g.fill();
    if (border) {g.strokeStyle=border; g.lineWidth=width; g.lineJoin='round'; g.stroke();}
  }
  const base = g.createLinearGradient(0,0,world.width,world.height);
  base.addColorStop(0,'#30484d'); base.addColorStop(.36,'#374e45'); base.addColorStop(.7,'#3a5449'); base.addColorStop(1,'#565644');
  g.fillStyle=base; g.fillRect(0,0,world.width,world.height);
  const coast = [[-40,-40],[405,-40],[307,302],[437,488],[331,694],[365,833],[126,1033],[95,1198],[220,1280],[187,1470],[350,1650],[144,1800],[116,1932],[194,2070],[106,2195],[247,2400],[158,2650],[-40,2650]];
  region(coast,'#224e55','#68785f',34);
  region(coast,'#285257','#4f7472',12);
  const east = [[3600,570],[3460,635],[3510,795],[3450,958],[3548,1080],[3494,1290],[3600,1380]];
  region(east,'#385b50','#65705b',17);
  const mountains = [[590,0],[690,314],[1000,454],[1300,383],[1650,498],[1960,370],[2250,516],[2510,418],[2770,506],[3080,347],[3180,0]];
  region(mountains,'#3c5150','#536464',13);

  for (let i=0;i<4300;i++) {
    const x=rng()*world.width, y=rng()*world.height;
    disc(x,y,1+rng()*5,1+rng()*2,rng()>.47?'#dce5ce12':'#17292125');
  }
  for (let i=0;i<90;i++) {
    const y=rng()*world.height, x=rng()*90;
    path([[x,y],[x+12,y+2],[x+34,y]],'#8fcdc331',2);
  }
  for (let i=0;i<17;i++) {
    const x=660+i*138, y=80+rng()*295, w=90+rng()*150, h=65+rng()*130;
    region([[x-w,y+h*.6],[x-w*.38,y-h*.25],[x,y-h],[x+w*.44,y-h*.15],[x+w,y+h*.55],[x+w*.24,y+h*.8]],'#2a3e42','#536766',3);
    region([[x,y-h],[x+w*.44,y-h*.15],[x+w,y+h*.55],[x+w*.05,y+h*.24]],'#536567');
    region([[x-w*.22,y-h*.49],[x,y-h],[x+w*.3,y-h*.39],[x+w*.07,y-h*.42]],'#88998e');
  }

  const hubs = missions.map(({x,y})=>[x,y]);
  const primary = [[spawn.x,spawn.y],[1830,1740],[1810,1470],[1835,1150],hubs[2]];
  const west = [[1810,1470],[1420,1620],[1120,1610],hubs[0],[490,1360],[500,1180],[715,1000],[1060,875],[1430,840],[1835,1150]];
  const right = [[1810,1470],[2240,1570],[2590,1530],hubs[1],[3210,1370],[3130,1040],[2730,870],[2470,915],[2190,860],[1835,1150]];
  const paths = [primary,west,right,[[spawn.x,spawn.y],[exit.x,exit.y]],
    [[spawn.x,spawn.y],[1550,2100],[1240,2020],[1070,2030]],
    [[spawn.x,spawn.y],[2050,2110],[2260,2060],[2540,2110],[2880,2085]]
  ];
  for (const line of paths) {
    path(line,'#293b37',39); path(line,'#74765e',29); path(line,'#bcb89b83',2,[12,12]);
  }
  const stations = missions.flatMap(mission => [mission,...mission.consoles, ...mission.sites, ...mission.sites.map(site=>site.note)]);
  for (const point of stations) {
    if (!hubs.some(([x,y])=>point.x===x&&point.y===y)) {
      const [x,y]=paths.flat().reduce((nearest,p)=>Math.hypot(p[0]-point.x,p[1]-point.y)<Math.hypot(nearest[0]-point.x,nearest[1]-point.y)?p:nearest);
      path([[x,y],[point.x,point.y]],'#a2a28058',10,[3,9]);
    }
  }

  for (let i=0;i<750;i++) {
    const x=165+rng()*3310, y=370+rng()*2180;
    if (x<450&&y<850 || stations.some(p=>Math.hypot(p.x-x,p.y-y)<92) || Math.hypot(x-1800,y-2250)<290) continue;
    const trail = paths.some(line => line.slice(1).some(([bx,by],i)=>{
      const [ax,ay]=line[i], dx=bx-ax,dy=by-ay, fraction=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
      return Math.hypot(x-ax-dx*fraction,y-ay-dy*fraction)<29;
    }));
    if (trail) continue;
    const r=8+rng()*20;
    if (x>2550&&y>1110) {
      disc(x+5,y+3,r,r*.5,'#242f2a55');
      disc(x,y,r*.65,r*.53,rng()>.5?'#727c59':'#526d47');
      for(let j=0;j<4;j++) disc(x+(rng()-.5)*r,y+(rng()-.5)*r*.5,3,3,'#929477');
    } else {
      disc(x+5,y+7,r*1.18,r*.6,'#1d322e82');
      g.fillStyle='#5e664b'; g.fillRect(x-3,y-8,6,17);
      region([[x-r,y],[x,y-r*1.55],[x+r,y],[x,y+r*.35]],rng()>.48?'#3e5b4d':'#345145');
      region([[x,y-r*1.55],[x+r,y],[x,y+r*.35]],'#6a87745c');
    }
  }

  function deck(x,y,color,large=false) {
    const width=large?174:80, height=large?110:58;
    g.fillStyle='#182825';g.fillRect(x-width/2+9,y-height/2+14,width,height);
    g.fillStyle='#4a564c';g.fillRect(x-width/2,y-height/2,width,height);
    g.fillStyle=color;g.globalAlpha=.55;g.fillRect(x-width/2,y-height/2,width,7);
    g.globalAlpha=1;
    for(let j=-width/2+9;j<width/2;j+=18) path([[x+j,y-height/2+10],[x+j,y+height/2-4]],'#99a58d41',2);
  }
  for (const [index,mission] of missions.entries()) {
    const {x,y,color} = mission;
    deck(x,y,color,true);
    for (const site of mission.sites) {
      const {x,y}=site;
      if (index===1) {
        region([[x-55,y],[x-44,y-55],[x+48,y-55],[x+55,y]],'#b28a59','#574f37',5);
        for(let d=-37;d<50;d+=21) path([[x+d,y-55],[x+d,y-3]],'#d8b779',8);
      } else if (index===2) {
        for (const d of [-13,13]) path([[x-74,y+d],[x+74,y+d]],'#9ca9a1',4);
        for (let d=-65;d<75;d+=19) path([[x+d,y-23],[x+d,y+23]],'#614e40',6);
      } else {
        disc(x,y,58,40,'#1f474799');disc(x,y,42,24,'#456f6f');
        for(let d=-58;d<60;d+=20) path([[x+d,y-20],[x+d,y+25]],'#8daa9980',3);
      }
      deck(x,y,color);
      disc(site.note.x,site.note.y,22,12,'#b9ad7877');
    }
    for (const route of mission.consoles) deck(route.x,route.y,color);
  }
  deck(spawn.x,spawn.y,'#d4ddb3',true); deck(exit.x,exit.y,'#98f6c5',true);
  for (let i=0;i<23;i++) {
    const angle=i*Math.PI*2/23;
    disc(spawn.x+Math.cos(angle)*192,spawn.y+Math.sin(angle)*117,4,4,'#d8e7b3');
  }
  g.fillStyle='#d3dfb77a';g.textAlign='center';g.font='bold 26px system-ui';
  g.fillText('출발 기지',spawn.x,spawn.y-99);
  for (const [x,y,label] of [[1550,2110,'‹ 해안'],[2050,2120,'시장 ›'],[1830,1845,'↑ 철길']]) {
    g.fillStyle='#203635';g.fillRect(x-49,y-34,98,30);
    g.fillStyle='#d9ddb9';g.font='bold 15px system-ui';g.fillText(label,x,y-14);
  }
  return surface;
}
