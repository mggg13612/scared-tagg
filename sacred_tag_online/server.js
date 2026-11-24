const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const chars = ["buddha", "jesus", "mary", "moses"];
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();

function cleanTeam(team) {
  if (!Array.isArray(team) || team.length !== 2) return ["buddha", "jesus"];
  return team.map(x => chars.includes(x) ? x : "buddha");
}
function publicRoom(room) {
  return {
    code: room.code,
    players: room.players.map(p => p ? { joined: true, ready: p.ready, team: p.team } : { joined: false }),
    phase: room.phase,
    state: room.state
  };
}
function broadcast(room) { io.to(room.code).emit("room:update", publicRoom(room)); }
function freshState() {
  return {
    fighters: [
      {x:250,y:0,hp:100,active:true,face:1,stun:0,guard:false,team:0},
      {x:710,y:0,hp:100,active:true,face:-1,stun:0,guard:false,team:1}
    ],
    effects: [], startedAt: Date.now()
  };
}
io.on("connection", socket => {
  socket.on("room:create", ({team}, cb = () => {}) => {
    let c; do { c = code(); } while (rooms.has(c));
    const room = {code:c, players:[{id:socket.id,team:cleanTeam(team),ready:true},null],phase:"lobby",state:freshState(),lastTick:Date.now()};
    rooms.set(c,room); socket.join(c); socket.data.room=c; socket.data.slot=0;
    cb({ok:true,code:c,slot:0,room:publicRoom(room)}); broadcast(room);
  });
  socket.on("room:join", ({code:c,team}, cb = () => {}) => {
    c = String(c || "").toUpperCase().trim();
    const room = rooms.get(c);
    if (!room) return cb({ok:false,error:"방을 찾을 수 없습니다."});
    if (room.players[1]) return cb({ok:false,error:"이미 두 명이 참가한 방입니다."});
    room.players[1] = {id:socket.id,team:cleanTeam(team),ready:true};
    socket.join(c); socket.data.room=c; socket.data.slot=1;
    cb({ok:true,code:c,slot:1,room:publicRoom(room)}); broadcast(room);
  });
  socket.on("team:update", team => {
    const room=rooms.get(socket.data.room), slot=socket.data.slot;
    if (!room || slot == null || room.phase==="fight") return;
    room.players[slot].team=cleanTeam(team); broadcast(room);
  });
  socket.on("match:start", () => {
    const room=rooms.get(socket.data.room);
    if (!room || !room.players[0] || !room.players[1]) return;
    room.phase="fight"; room.state=freshState();
    room.state.fighters[0].team=0; room.state.fighters[1].team=1;
    broadcast(room); io.to(room.code).emit("match:started");
  });
  socket.on("input", input => {
    const room=rooms.get(socket.data.room), slot=socket.data.slot;
    if (!room || room.phase!=="fight" || slot == null) return;
    const f=room.state.fighters[slot];
    const now=Date.now();
    const dt=Math.min(.05,(now-room.lastTick)/1000); room.lastTick=now;
    if (f.hp<=0) return;
    const keys=input || {};
    f.guard=!!keys.guard;
    if (f.stun>0) f.stun=Math.max(0,f.stun-dt);
    else {
      if (keys.left) f.x-=260*dt;
      if (keys.right) f.x+=260*dt;
      if (keys.jump && f.y===0) f.vy=460;
      if (f.vy!==undefined) { f.y+=f.vy*dt; f.vy-=1100*dt; if(f.y<0){f.y=0;f.vy=0;} }
      f.x=Math.max(45,Math.min(915,f.x));
      const enemy=room.state.fighters[1-slot];
      f.face=enemy.x>=f.x?1:-1;
      const hit=(damage,range,stun=0.25)=>{
        if (Math.abs(enemy.x-f.x)<=range && enemy.hp>0) {
          const dealt=enemy.guard?Math.ceil(damage*.2):damage;
          enemy.hp=Math.max(0,enemy.hp-dealt);
          enemy.stun=Math.max(enemy.stun,enemy.guard?0:stun);
          enemy.x=Math.max(45,Math.min(915,enemy.x+f.face*(enemy.guard?8:22)));
        }
      };
      if(keys.light && now-(f.lastLight||0)>360){f.lastLight=now;hit(5,105);}
      if(keys.heavy && now-(f.lastHeavy||0)>850){f.lastHeavy=now;hit(12,125,.45);}
      if(keys.skill1 && now-(f.lastS1||0)>5000){f.lastS1=now;hit(slot===0?13:14,slot===0?155:350,.55); if(slot===0)f.hp=Math.min(100,f.hp+3);}
      if(keys.skill2 && now-(f.lastS2||0)>9000){f.lastS2=now; if(slot===0)f.hp=Math.min(100,f.hp+18); else hit(18,230,.8);}
      if(keys.tag && now-(f.lastTag||0)>1200){f.lastTag=now;f.tagged=!f.tagged;f.hp=Math.min(100,f.hp+2);}
    }
    if(room.state.fighters.some(x=>x.hp<=0)) room.phase="result";
    io.to(room.code).emit("state:update",room.state);
    if(room.phase==="result") broadcast(room);
  });
  socket.on("disconnect",()=>{
    const c=socket.data.room, slot=socket.data.slot, room=rooms.get(c);
    if(!room) return;
    if(room.players[slot]?.id===socket.id) room.players[slot]=null;
    room.phase="lobby"; broadcast(room);
    if(!room.players[0]&&!room.players[1]) rooms.delete(c);
  });
});
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Sacred Tag Online listening on ${PORT}`));
