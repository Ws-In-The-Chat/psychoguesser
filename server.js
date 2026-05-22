const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { LOCATIONS_ALL, UNITS } = require('./locations');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Daily Challenge ────────────────────────────────────────────────────────────
const SCORES_FILE = path.join(__dirname, 'daily-scores.json');

function readScores() {
  try { return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); }
  catch { return {}; }
}
function writeScores(data) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(data, null, 2));
}
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function dailySeed() {
  const d = new Date();
  const str = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function getDailyLocations() {
  const rng = mulberry32(dailySeed());
  const arr = [...LOCATIONS_ALL];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 5);
}

app.get('/api/daily/leaderboard', (req, res) => {
  const scores = readScores();
  const today = todayKey();
  const entries = (scores[today] || []).sort((a, b) => b.score - a.score).slice(0, 20);
  res.json({ date: today, entries });
});

app.post('/api/daily/submit', (req, res) => {
  const { uuid, name, avatar, score } = req.body;
  if (!uuid || !name || typeof score !== 'number') return res.status(400).json({ error: 'Invalid' });
  const scores = readScores();
  const today = todayKey();
  if (!scores[today]) scores[today] = [];
  const existing = scores[today].find(e => e.uuid === uuid);
  if (existing) {
    if (score > existing.score) { existing.score = score; existing.name = name.trim().slice(0, 20); existing.avatar = avatar; }
    writeScores(scores);
    const rank = scores[today].sort((a, b) => b.score - a.score).findIndex(e => e.uuid === uuid) + 1;
    return res.json({ ok: true, rank });
  }
  scores[today].push({ uuid, name: name.trim().slice(0, 20), avatar, score, submittedAt: Date.now() });
  // Prune entries older than 7 days
  const cutoff = Date.now() - 7 * 86400000;
  for (const key of Object.keys(scores)) {
    if (new Date(key).getTime() < cutoff) delete scores[key];
  }
  writeScores(scores);
  const rank = scores[today].sort((a, b) => b.score - a.score).findIndex(e => e.uuid === uuid) + 1;
  res.json({ ok: true, rank });
});


// ── Community Maps ─────────────────────────────────────────────────────────────
const COMMUNITY_FILE = path.join(__dirname, 'community-locations.json');

function readCommunityLocations() {
  try { return JSON.parse(fs.readFileSync(COMMUNITY_FILE, 'utf8')); }
  catch { return []; }
}
function writeCommunityLocations(locs) {
  fs.writeFileSync(COMMUNITY_FILE, JSON.stringify(locs, null, 2));
}

app.get('/api/community/count', (req, res) => {
  res.json({ count: readCommunityLocations().length });
});

app.get('/api/community/locations', (req, res) => {
  const locs = readCommunityLocations();
  res.json({ count: locs.length, locations: locs.map(l => ({ id: l.id, name: l.name, city: l.city, author: l.author })) });
});

app.post('/api/community/submit', (req, res) => {
  const { name, city, lat, lng, clues, fact, author } = req.body;
  if (!name?.trim() || !city?.trim() || !lat || !lng || !clues?.length || !fact?.trim())
    return res.status(400).json({ error: 'Missing required fields.' });
  const locs = readCommunityLocations();
  const newLoc = {
    id: `c${Date.now()}`,
    name: name.trim().slice(0, 80), city: city.trim().slice(0, 80),
    lat: parseFloat(lat), lng: parseFloat(lng),
    clues: clues.slice(0, 4).map(c => c.trim()).filter(Boolean),
    fact: fact.trim().slice(0, 500),
    author: (author || 'Anonymous').trim().slice(0, 30),
    gradient: '135deg, #1a1230, #0a0818', icon: '📍',
    wikiTitle: null, submittedAt: Date.now()
  };
  locs.push(newLoc);
  writeCommunityLocations(locs);
  res.json({ ok: true, id: newLoc.id, count: locs.length });
});

// ── Username filter ───────────────────────────────────────────────────────────
// Authoritative server-side profanity / slur filter for player names.
const BAD_WORDS = [
  // racial / ethnic / homophobic slurs
  'nigger','nigga','nigga','negro','coon','chink','gook','spic','wetback','kike','beaner',
  'wop','dago','paki','raghead','towelhead','sandnigger','jigaboo','porchmonkey','tarbaby',
  'faggot','faggit','fagot','fag','dyke','tranny','queer','homo',
  'retard','retarded','spastic','cripple','midget',
  // strong profanity
  'fuck','fuk','fuc','phuck','motherfucker','fucker','fucking','fuckface','clusterfuck',
  'shit','shyt','bullshit','dipshit','shithead','bitch','biatch','bastard','asshole',
  'dumbass','jackass','dickhead','douchebag','douche','wanker','bollocks',
  // sexual
  'cunt','pussy','penis','vagina','dick','cock','boner','cum','semen','jizz','blowjob',
  'handjob','rimjob','tits','titty','boobs','nipple','dildo','horny','whore','slut',
  'hooker','porn','pornhub','masturbate','orgasm','anal','rape','rapist','molest','pedophile','pedo',
  // hate / nazi
  'nazi','hitler','heil','kkk','klan','genocide','lynch',
];

function isBadName(name) {
  const norm = String(name || '').toLowerCase()
    .replace(/[4@]/g, 'a').replace(/[1!|]/g, 'i').replace(/3/g, 'e')
    .replace(/[5$]/g, 's').replace(/0/g, 'o').replace(/7/g, 't').replace(/9/g, 'g')
    .replace(/[^a-z]/g, '');
  if (!norm) return false;
  return BAD_WORDS.some(w => norm.includes(w));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const rooms = new Map();

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:5}, () => c[Math.floor(Math.random()*c.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcScore(km, elapsedSec, timeLimit) {
  // Exponential decay — 5k requires near-perfect accuracy (~0.1km)
  // At 10km: ~4600, at 50km: ~3100, at 200km: ~780
  const distScore = Math.round(5000 * Math.exp(-km / 150));
  const timeBonus = timeLimit < 999 ? Math.round(Math.max(0, timeLimit - elapsedSec) * 8) : 0;
  return Math.min(5000, distScore + timeBonus);
}

function timeLimitFor(room) {
  if (room.customTimeLimit) return room.customTimeLimit;
  return { classic:60, sprint:25, detective:80, practice:999 }[room.mode] ?? 60;
}

function roundsFor(mode, customRounds) {
  // Sprint and community keep fixed round counts; others honor the host's choice
  if (mode === 'sprint') return 8;
  if (mode === 'community') return 5;
  if (customRounds && customRounds >= 1 && customRounds <= 20) return customRounds;
  return { classic:5, detective:5, practice:5 }[mode] ?? 5;
}

function poolForUnit(unit) {
  return (UNITS[unit] || UNITS.all).locations;
}

function pickLocations(mode, unit = 'all', customRounds) {
  const n = roundsFor(mode, customRounds);
  if (mode === 'community') {
    const locs = readCommunityLocations();
    const pool = locs.length >= 5 ? locs : LOCATIONS_ALL;
    return [...pool].sort(() => Math.random()-0.5).slice(0, n);
  }
  const pool = poolForUnit(unit);
  const shuffled = [...pool].sort(() => Math.random()-0.5);
  // If more rounds requested than the pool holds, top up from the full pool
  if (n > shuffled.length) {
    const extra = [...LOCATIONS_ALL].sort(() => Math.random()-0.5);
    for (const loc of extra) {
      if (shuffled.length >= n) break;
      if (!shuffled.includes(loc)) shuffled.push(loc);
    }
  }
  return shuffled.slice(0, n);
}

function defaultAvatar(name) {
  // fallback if client sends no avatar
  const colors = ['#8b5cf6','#06b6d4','#22c55e','#f97316','#ec4899','#fbbf24','#ef4444','#14b8a6'];
  let h = 0;
  for (const c of (name||'?')) h = ((h<<5)-h) + c.charCodeAt(0);
  const initials = (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return { initials, color: colors[Math.abs(h) % colors.length], label: name };
}

// ── Team / Duel helpers ───────────────────────────────────────────────────────
const DUEL_HP = 5000;

function roundMultiplier(roundIndexZeroBased) {
  // Rounds 1-3 = x1, then +0.5 each round (r4=1.5, r5=2, r6=2.5 ...)
  const n = roundIndexZeroBased + 1;
  return n <= 3 ? 1 : 1 + (n - 3) * 0.5;
}

function distPoints(km) {
  return Math.round(5000 * Math.exp(-km / 150));
}

function teamBest(room, team) {
  let best = -1, bestPlayer = null;
  for (const p of room.players.values()) {
    if (p.team !== team) continue;
    const ans = room.roundAnswers.get(p.id);
    if (!ans) continue;
    const dp = distPoints(ans.km);
    if (dp > best) { best = dp; bestPlayer = p; }
  }
  return { points: best < 0 ? 0 : best, player: bestPlayer, km: bestPlayer ? room.roundAnswers.get(bestPlayer.id).km : null };
}

function teamCounts(room) {
  let A = 0, B = 0;
  for (const p of room.players.values()) { if (p.team === 'A') A++; else if (p.team === 'B') B++; }
  return { A, B };
}

function publicRoom(room) {
  return {
    code: room.code,
    host: room.host,
    state: room.state,
    mode: room.mode,
    unit: room.unit || 'all',
    unitName: (UNITS[room.unit || 'all'] || UNITS.all).name,
    customTimeLimit: room.customTimeLimit || null,
    customRounds: room.customRounds || null,
    teamMode: room.teamMode || false,
    teamHealth: room.teamHealth || { A: DUEL_HP, B: DUEL_HP },
    isDaily: room.isDaily || false,
    round: room.round,
    totalRounds: room.locations.length,
    guessCount: room.roundAnswers.size,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, team: p.team || null
    }))
  };
}

// ── Game flow ────────────────────────────────────────────────────────────────
function beginRound(room) {
  room.state = 'round';
  room.roundAnswers.clear();
  room.roundStart = Date.now();
  const loc = room.locations[room.round];
  const tl = timeLimitFor(room);

  io.to(room.code).emit('round-start', {
    round: room.round + 1,
    totalRounds: room.locations.length,
    timeLimit: tl,
    mode: room.mode,
    gradient: loc.gradient,
    icon: loc.icon,
    wikiTitle: loc.wikiTitle,
    clue: loc.clues[0],
    room: publicRoom(room),
  });

  // Detective mode: progressive clues at 15s intervals
  if (room.mode === 'detective') {
    [1, 2, 3].forEach((ci, i) => {
      const t = setTimeout(() => {
        if (room.state === 'round' && loc.clues[ci])
          io.to(room.code).emit('new-clue', { clue: loc.clues[ci], clueNum: ci+1 });
      }, (i+1)*18000);
      room.clueTimers.push(t);
    });
  }

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => {
    if (room.state === 'round') finishRound(room);
  }, (tl + 3) * 1000);
}

function finishRound(room) {
  if (room.state !== 'round') return;
  room.state = 'results';
  clearTimeout(room.roundTimer);
  room.clueTimers.forEach(clearTimeout);
  room.clueTimers = [];
  const loc = room.locations[room.round];

  const results = Array.from(room.players.values()).map(p => {
    const ans = room.roundAnswers.get(p.id);
    return {
      id: p.id, name: p.name, avatar: p.avatar, totalScore: p.score, team: p.team || null,
      roundPts: ans?.pts ?? 0,
      guess: ans ? { lat: ans.lat, lng: ans.lng } : null,
      km: ans ? Math.round(ans.km) : null,
    };
  }).sort((a, b) => b.roundPts - a.roundPts);

  // Team duel scoring
  let teamResult = null;
  if (room.teamMode) {
    const a = teamBest(room, 'A');
    const b = teamBest(room, 'B');
    const mult = roundMultiplier(room.round);
    let winner = null, loser = null, damage = 0;
    if (a.points !== b.points) {
      winner = a.points > b.points ? 'A' : 'B';
      loser = winner === 'A' ? 'B' : 'A';
      damage = Math.round((Math.max(a.points, b.points) - Math.min(a.points, b.points)) * mult);
      room.teamHealth[loser] = Math.max(0, room.teamHealth[loser] - damage);
    }
    teamResult = {
      a: a.points, b: b.points, winner, loser, damage, mult,
      health: { A: room.teamHealth.A, B: room.teamHealth.B },
      bestA: a.player ? { name: a.player.name, avatar: a.player.avatar, km: Math.round(a.km) } : null,
      bestB: b.player ? { name: b.player.name, avatar: b.player.avatar, km: Math.round(b.km) } : null,
    };
  }

  const knockout = room.teamMode && (room.teamHealth.A <= 0 || room.teamHealth.B <= 0);

  io.to(room.code).emit('round-results', {
    results,
    teamResult,
    answer: { lat: loc.lat, lng: loc.lng, name: loc.name, city: loc.city, fact: loc.fact, gradient: loc.gradient, icon: loc.icon, wikiTitle: loc.wikiTitle },
    isLast: knockout || room.round >= room.locations.length - 1,
    room: publicRoom(room),
  });
}

function finishGame(room) {
  room.state = 'finished';
  if (room.teamMode) {
    const { A, B } = room.teamHealth;
    const winningTeam = A === B ? null : (A > B ? 'A' : 'B');
    io.to(room.code).emit('game-over', { teamMode: true, teamHealth: { A, B }, winningTeam, room: publicRoom(room) });
  } else {
    const final = Array.from(room.players.values()).sort((a, b) => b.score - a.score);
    io.to(room.code).emit('game-over', { final, room: publicRoom(room) });
  }
}

// ── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('create-room', ({ name, mode = 'classic', avatar, unit = 'all' }) => {
    if (!name?.trim()) return;
    if (isBadName(name)) return socket.emit('name-error', 'Please choose a different name — that one isn\'t allowed.');
    const code = genCode();
    const safeUnit = UNITS[unit] ? unit : 'all';
    const room = {
      code, host: socket.id, players: new Map(), state: 'lobby',
      mode, unit: safeUnit, locations: pickLocations(mode, safeUnit), customTimeLimit: null,
      customRounds: null, teamMode: false, teamHealth: { A: DUEL_HP, B: DUEL_HP },
      round: 0, roundAnswers: new Map(),
      roundTimer: null, roundStart: 0, clueTimers: [],
    };
    const av = avatar || defaultAvatar(name);
    room.players.set(socket.id, { id:socket.id, name:name.trim(), avatar:av, score:0, team:null });
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', { code, room: publicRoom(room) });
  });

  socket.on('join-room', ({ code, name, avatar }) => {
    if (isBadName(name)) return socket.emit('join-error', 'Please choose a different name — that one isn\'t allowed.');
    const room = rooms.get((code||'').toUpperCase().trim());
    if (!room) return socket.emit('join-error', 'Room not found. Check the code and try again.');
    if (room.state !== 'lobby') return socket.emit('join-error', 'This game is already in progress.');
    if (room.players.size >= 8) return socket.emit('join-error', 'Room is full (8 players max).');
    const av = avatar || defaultAvatar(name);
    let joinTeam = null;
    if (room.teamMode) { const c = teamCounts(room); joinTeam = c.A <= c.B ? 'A' : 'B'; }
    room.players.set(socket.id, { id:socket.id, name:(name||'?').trim(), avatar:av, score:0, team:joinTeam });
    socket.join(code);
    socket.emit('room-joined', { code, room: publicRoom(room) });
    socket.to(room.code).emit('player-joined', { name:(name||'?').trim(), avatar:av, room: publicRoom(room) });
  });

  socket.on('change-mode', ({ code, mode }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.mode = mode;
    room.customTimeLimit = null;
    room.locations = pickLocations(mode, room.unit, room.customRounds);
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('change-unit', ({ code, unit }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.unit = UNITS[unit] ? unit : 'all';
    room.locations = pickLocations(room.mode, room.unit, room.customRounds);
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('change-rounds', ({ code, rounds }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    const n = parseInt(rounds);
    room.customRounds = (n >= 1 && n <= 20) ? n : null;
    room.locations = pickLocations(room.mode, room.unit, room.customRounds);
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('change-time', ({ code, timeLimit }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.customTimeLimit = timeLimit;
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('toggle-team', ({ code, on }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.teamMode = !!on;
    if (room.teamMode) {
      let i = 0;
      for (const p of room.players.values()) {
        if (p.team !== 'A' && p.team !== 'B') { p.team = (i % 2 === 0) ? 'A' : 'B'; i++; }
      }
    }
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('set-team', ({ code, team }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'lobby') return;
    if (team !== 'A' && team !== 'B') return;
    const p = room.players.get(socket.id);
    if (p) p.team = team;
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('start-game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if (room.teamMode) {
      const c = teamCounts(room);
      if (!c.A || !c.B) return socket.emit('start-error', 'Both teams need at least one player.');
      room.teamHealth = { A: DUEL_HP, B: DUEL_HP };
    }
    beginRound(room);
  });

  socket.on('guess', ({ code, lat, lng }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'round') return;
    if (room.roundAnswers.has(socket.id)) return;
    const loc = room.locations[room.round];
    const km = haversineKm(lat, lng, loc.lat, loc.lng);
    const elapsed = (Date.now() - room.roundStart) / 1000;
    const pts = calcScore(km, elapsed, timeLimitFor(room));
    room.roundAnswers.set(socket.id, { lat, lng, km, pts });
    const p = room.players.get(socket.id);
    if (p) p.score += pts;

    // Broadcast this guess position to all players for live map
    io.to(code).emit('guess-placed', {
      id: socket.id, name: p?.name, avatar: p?.avatar, lat, lng
    });
    io.to(code).emit('player-guessed', { id:socket.id, guessed:room.roundAnswers.size, total:room.players.size });
    socket.emit('your-result', { km:Math.round(km), pts });

    // Shorten timer for remaining players: cut to 15s after first guess
    const tl = timeLimitFor(room);
    const remaining = tl - elapsed;
    const CUT_TO = 15;
    if (remaining > CUT_TO && room.roundAnswers.size < room.players.size && tl < 999) {
      clearTimeout(room.roundTimer);
      const newEndTime = Date.now() + CUT_TO * 1000;
      room.roundTimer = setTimeout(() => {
        if (room.state === 'round') finishRound(room);
      }, CUT_TO * 1000);
      io.to(code).emit('timer-sync', { endTime: newEndTime });
    }

    if (room.roundAnswers.size >= room.players.size) finishRound(room);
  });

  socket.on('next-round', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'results') return;
    room.round++;
    const knockout = room.teamMode && (room.teamHealth.A <= 0 || room.teamHealth.B <= 0);
    if (knockout || room.round >= room.locations.length) finishGame(room);
    else beginRound(room);
  });

  socket.on('play-again', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby';
    room.round = 0;
    room.locations = room.isDaily ? getDailyLocations() : pickLocations(room.mode, room.unit, room.customRounds);
    room.roundAnswers.clear();
    room.teamHealth = { A: DUEL_HP, B: DUEL_HP };
    room.players.forEach(p => { p.score = 0; });
    io.to(code).emit('room-updated', { room: publicRoom(room) });
    io.to(code).emit('back-to-lobby', { room: publicRoom(room) });
  });

  socket.on('start-daily', ({ name, avatar }) => {
    if (!name?.trim()) return;
    if (isBadName(name)) return socket.emit('name-error', 'Please choose a different name — that one isn\'t allowed.');
    const code = genCode();
    const av = avatar || defaultAvatar(name);
    const room = {
      code, host: socket.id, players: new Map(), state: 'lobby',
      mode: 'classic', unit: 'all', locations: getDailyLocations(), customTimeLimit: null,
      isDaily: true, round: 0, roundAnswers: new Map(),
      roundTimer: null, roundStart: 0, clueTimers: [],
    };
    room.players.set(socket.id, { id: socket.id, name: name.trim(), avatar: av, score: 0 });
    rooms.set(code, room);
    socket.join(code);
    socket.emit('daily-started', { code });
    beginRound(room);
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      if (!room.players.has(socket.id)) continue;
      room.players.delete(socket.id);
      if (room.players.size === 0) {
        clearTimeout(room.roundTimer);
        room.clueTimers.forEach(clearTimeout);
        rooms.delete(code);
      } else {
        if (room.host === socket.id)
          room.host = [...room.players.keys()][0];
        io.to(code).emit('player-left', { id:socket.id, room: publicRoom(room) });
        if (room.state === 'round' && room.roundAnswers.size >= room.players.size)
          finishRound(room);
      }
      break;
    }
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) { localIP = addr.address; break; }
    }
    if (localIP !== 'localhost') break;
  }
  console.log('\n🧠  PsychoGuesser is running!\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}  ← share this with friends on the same WiFi\n`);
});
