const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  const arr = [...LOCATIONS];
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

// ── Location Data (server is source of truth for coords) ──────────────────────
const LOCATIONS = [
  {
    id:'l1', name:'Freud Museum', city:'Vienna, Austria',
    lat:48.2231, lng:16.3567,
    gradient:'135deg, #2d1060, #0d0020',
    icon:'🛋️', wikiTitle:'Berggasse_19',
    clues:[
      'A 19th-century residential building on a quiet cobblestone side street.',
      'Located in a Habsburg-era Central European capital famed for its coffee houses and opera.',
      'This apartment building is now one of psychology\'s most-visited museums.',
      'Sigmund Freud lived and saw patients here for 47 years — until 1938.'
    ],
    fact:'Berggasse 19, Vienna — Freud\'s home and consulting room from 1891–1938. He developed psychoanalysis here before fleeing Nazi-occupied Austria for London.',
    difficulty:'medium'
  },
  {
    id:'l2', name:'Psychology\'s Birthplace', city:'Leipzig, Germany',
    lat:51.3397, lng:12.3731,
    gradient:'135deg, #0a2d14, #001a08',
    icon:'🔬', wikiTitle:'Leipzig_University',
    clues:[
      'A grand European university with classical architecture surrounding an open plaza.',
      'Located in a German industrial city in the state of Saxony, famous for its trade fairs.',
      'This campus was the site of the most important founding moment in all of psychology.',
      'Wilhelm Wundt established the world\'s first experimental psychology laboratory here in 1879.'
    ],
    fact:'Leipzig University — Wilhelm Wundt\'s 1879 laboratory here marks psychology\'s official birth as an experimental science, separating it from philosophy.',
    difficulty:'hard'
  },
  {
    id:'l3', name:'Milgram\'s Obedience Lab', city:'New Haven, Connecticut, USA',
    lat:41.3163, lng:-72.9223,
    gradient:'135deg, #0f2a1a, #001510',
    icon:'⚡', wikiTitle:'Yale_University',
    clues:[
      'Gothic stone buildings enclosing a historic courtyard — one of America\'s most prestigious campuses.',
      'Founded in 1701, this is the third-oldest university in the United States.',
      'Located in a coastal New England city on Long Island Sound.',
      'Stanley Milgram conducted his landmark obedience studies here in 1961–62, finding that ~65% of participants went to the maximum shock level.'
    ],
    fact:'Yale University, New Haven — site of Milgram\'s 1961 obedience experiments. His findings shocked the world: ordinary people obeyed authority figures even when believing they were harming others.',
    difficulty:'medium'
  },
  {
    id:'l4', name:'The Prison Experiment', city:'Stanford, California, USA',
    lat:37.4275, lng:-122.1697,
    gradient:'135deg, #2d1500, #1a0800',
    icon:'🏛️', wikiTitle:'Stanford_University',
    clues:[
      'A sweeping campus with warm sandstone buildings and terracotta rooftops bathed in California sun.',
      'Located in the heart of Silicon Valley, south of San Francisco.',
      'A world-famous research university founded in 1885 by railway magnate Leland Stanford.',
      'Philip Zimbardo\'s infamous prison simulation ran in this psychology building basement in 1971 — and had to be shut down after just 6 days.'
    ],
    fact:'Stanford University, CA — The 1971 Stanford Prison Experiment, led by Zimbardo, revealed how quickly ordinary people conform to roles. It was halted early due to psychological harm inflicted on participants.',
    difficulty:'easy'
  },
  {
    id:'l5', name:'Skinner\'s Behaviorism Lab', city:'Cambridge, Massachusetts, USA',
    lat:42.3770, lng:-71.1167,
    gradient:'135deg, #2d0808, #1a0000',
    icon:'🐦', wikiTitle:'Harvard_University',
    clues:[
      'Red-brick Georgian buildings draped in ivy around a classic American university green.',
      'Founded in 1636 — the oldest university in the United States.',
      'Located just across the river from a major northeastern city.',
      'B.F. Skinner spent most of his career here developing operant conditioning and the Skinner Box.'
    ],
    fact:'Harvard University, Cambridge MA — B.F. Skinner\'s home for decades. Here he refined operant conditioning, wrote "Walden Two," and shaped 20th-century behaviorism.',
    difficulty:'easy'
  },
  {
    id:'l6', name:'Pavlov\'s Conditioning Lab', city:'St. Petersburg, Russia',
    lat:59.9383, lng:30.3155,
    gradient:'135deg, #0a1e3d, #050e20',
    icon:'🔔', wikiTitle:'Pavlov\'s_dog',
    clues:[
      'An imposing Russian neoclassical scientific institution with a grand symmetrical facade.',
      'Located in a city of canals, palaces, and White Nights on the Gulf of Finland.',
      'A major biomedical research center established in the 1890s.',
      'Ivan Pavlov worked here when he discovered classical conditioning while studying digestion in dogs — earning the Nobel Prize in 1904.'
    ],
    fact:'Institute of Experimental Medicine, St. Petersburg — Pavlov\'s dog experiments here revealed classical conditioning: pairing a neutral stimulus with an unconditioned one creates a new reflex.',
    difficulty:'hard'
  },
  {
    id:'l7', name:'Little Albert\'s Hospital', city:'Baltimore, Maryland, USA',
    lat:39.2964, lng:-76.5921,
    gradient:'135deg, #0a1e2d, #050e18',
    icon:'🏥', wikiTitle:'Johns_Hopkins_Hospital',
    clues:[
      'A grand Gilded Age medical complex with a soaring central dome — a landmark in American medicine.',
      'Located in a historic port city on the Chesapeake Bay.',
      'One of the world\'s most prestigious research hospitals, founded in 1889.',
      'John Watson and Rosalie Rayner conducted the "Little Albert" fear-conditioning study here in 1920.'
    ],
    fact:'Johns Hopkins Hospital, Baltimore — site of Watson & Rayner\'s 1920 "Little Albert" experiment, demonstrating that human emotional responses can be classically conditioned.',
    difficulty:'medium'
  },
  {
    id:'l8', name:'Charcot\'s Hysteria Theater', city:'Paris, France',
    lat:48.8378, lng:2.3620,
    gradient:'135deg, #2d1e00, #1a1000',
    icon:'🧠', wikiTitle:'Pitié-Salpêtrière_hospital',
    clues:[
      'A vast, centuries-old hospital complex with a distinctive domed chapel rising over the Seine.',
      'Located in the 13th arrondissement of the world\'s most-visited city.',
      'One of the oldest and largest hospitals in Europe — a literal city within a city.',
      'Jean-Martin Charcot gave his famous "Tuesday Lectures" on hysteria and hypnosis here. A young Sigmund Freud attended as a student.'
    ],
    fact:'Salpêtrière Hospital, Paris — Charcot\'s 1870s–80s demonstrations of hypnosis and hysteria directly influenced Freud\'s development of psychoanalysis and the concept of the unconscious.',
    difficulty:'hard'
  },
  {
    id:'l9', name:'Piaget\'s Developmental Lab', city:'Geneva, Switzerland',
    lat:46.2040, lng:6.1474,
    gradient:'135deg, #1a1a00, #0e0e00',
    icon:'🧩', wikiTitle:'University_of_Geneva',
    clues:[
      'A European university campus nestled between a large glacial lake and Alpine foothills.',
      'Located in a city that is Switzerland\'s second-largest — a global hub for diplomacy and finance.',
      'The UN\'s European headquarters and the Red Cross are nearby.',
      'Jean Piaget spent decades here developing his four-stage theory of cognitive development.'
    ],
    fact:'University of Geneva — Jean Piaget\'s research home for most of his career. His observations of children here produced the four stages of cognitive development (sensorimotor, preoperational, concrete operational, formal operational).',
    difficulty:'medium'
  },
  {
    id:'l10', name:'Bedlam — The Original Asylum', city:'London, England',
    lat:51.4992, lng:-0.0875,
    gradient:'135deg, #181818, #0a0a0a',
    icon:'🏰', wikiTitle:'Bethlem_Royal_Hospital',
    clues:[
      'A neoclassical British building with a long colonnaded facade set in parkland.',
      'Located south of the River Thames in the British capital.',
      'Founded in 1247, this is the oldest psychiatric institution in the world.',
      'Its nickname — "Bedlam" — became an English word for chaos. For centuries, the public paid to watch patients as entertainment.'
    ],
    fact:'Bethlem Royal Hospital, London — founded 1247. Its brutal history mirrors the evolution of mental health treatment. "Bedlam" entered the English language as a synonym for chaotic disorder.',
    difficulty:'medium'
  },
  {
    id:'l11', name:'Phineas Gage Accident', city:'Cavendish, Vermont, USA',
    lat:43.4201, lng:-72.6010,
    gradient:'135deg, #0a2000, #040f00',
    icon:'🚂', wikiTitle:'Phineas_Gage',
    clues:[
      'A small, quiet New England town surrounded by dense forests and rolling hills.',
      'Located in one of the least-populated states in the United States — in the northeast.',
      'A rural railroad construction site in the mid-19th century.',
      'In 1848, an accidental explosion drove a 3.5-foot iron rod through a railroad worker\'s skull here. He survived — but his personality changed completely, providing early evidence linking the frontal lobe to behavior.'
    ],
    fact:'Cavendish, Vermont — Phineas Gage\'s 1848 accident destroyed his left frontal lobe. His dramatic personality shift provided the first strong evidence that personality and social behavior are governed by specific brain regions.',
    difficulty:'hard'
  },
  {
    id:'l12', name:'Asch Conformity Experiments', city:'Swarthmore, Pennsylvania, USA',
    lat:39.9023, lng:-75.3552,
    gradient:'135deg, #0a1020, #050810',
    icon:'📏', wikiTitle:'Swarthmore_College',
    clues:[
      'A small, lush liberal arts campus with Victorian stone buildings and manicured grounds.',
      'Located in a leafy suburb less than 30 minutes from Philadelphia.',
      'A highly selective Quaker college founded in 1864.',
      'Solomon Asch ran his famous line-length conformity experiments here in the 1950s — 75% of participants gave at least one wrong answer to fit the group.'
    ],
    fact:'Swarthmore College, PA — Solomon Asch\'s 1951–56 conformity studies here showed the powerful pressure of normative social influence: most people will deny obvious reality to agree with a group.',
    difficulty:'hard'
  },
  {
    id:'l13', name:'Maslow\'s Hierarchy Classroom', city:'Brooklyn, New York, USA',
    lat:40.6303, lng:-73.9502,
    gradient:'135deg, #200010, #0f0008',
    icon:'🔺', wikiTitle:'Brooklyn_College',
    clues:[
      'A Georgian Revival campus with columned red-brick buildings in one of America\'s most diverse cities.',
      'Located in New York\'s most populous borough.',
      'A CUNY college founded in 1930, tuition-free for decades and beloved for its public mission.',
      'Abraham Maslow taught here from 1937–1951 — the years he developed the famous pyramid.'
    ],
    fact:'Brooklyn College, NY — Maslow taught psychology here for 14 years while developing humanistic psychology and his hierarchy of needs (physiological → safety → love → esteem → self-actualization).',
    difficulty:'hard'
  },
  {
    id:'l14', name:'Jung\'s Home & Tower', city:'Küsnacht, Switzerland',
    lat:47.3194, lng:8.5935,
    gradient:'135deg, #0a1830, #040e1a',
    icon:'🌊', wikiTitle:'Küsnacht',
    clues:[
      'A peaceful lakeside village lined with elegant villas and old stone walls.',
      'Located on the eastern shore of a famous Swiss lake, a short boat ride from a major banking city.',
      'A wealthy, quiet residential municipality in the canton of Zurich.',
      'Carl Gustav Jung lived here from 1909 until his death in 1961, building his famous stone "Tower" nearby and founding analytical psychology.'
    ],
    fact:'Küsnacht, Zürich — Jung\'s lifelong home. He built his iconic stone tower in nearby Bollingen as a place for solitary retreat. The C.G. Jung Institute, founded here in 1948, trains analysts worldwide.',
    difficulty:'hard'
  },
  {
    id:'l15', name:'Tuskegee Ethics Landmark', city:'Tuskegee, Alabama, USA',
    lat:32.4272, lng:-85.7062,
    gradient:'135deg, #2d1500, #1a0a00',
    icon:'⚕️', wikiTitle:'Tuskegee_University',
    clues:[
      'A historically significant university campus with red-brick buildings in the rural Deep South.',
      'Located in Alabama, founded by Booker T. Washington in 1881.',
      'A Historically Black College and University (HBCU) with a famous heritage in agriculture and science.',
      'The U.S. Public Health Service conducted its infamous 40-year syphilis study through this institution (1932–1972), fundamentally changing research ethics and informed consent law.'
    ],
    fact:'Tuskegee University, Alabama — the USPHS syphilis study here deliberately withheld treatment from 399 Black men for 40 years. Its exposure in 1972 led directly to modern bioethical standards and the Belmont Report.',
    difficulty:'medium'
  }
];

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

function roundsFor(mode) {
  return { classic:5, sprint:8, detective:5, practice:5, community:5 }[mode] ?? 5;
}

function pickLocations(mode) {
  if (mode === 'community') {
    const locs = readCommunityLocations();
    const pool = locs.length >= 5 ? locs : [...LOCATIONS];
    return [...pool].sort(() => Math.random()-0.5).slice(0, 5);
  }
  const shuffled = [...LOCATIONS].sort(() => Math.random()-0.5);
  return shuffled.slice(0, roundsFor(mode));
}

function defaultAvatar(name) {
  // fallback if client sends no avatar
  const colors = ['#8b5cf6','#06b6d4','#22c55e','#f97316','#ec4899','#fbbf24','#ef4444','#14b8a6'];
  let h = 0;
  for (const c of (name||'?')) h = ((h<<5)-h) + c.charCodeAt(0);
  const initials = (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return { initials, color: colors[Math.abs(h) % colors.length], label: name };
}

function publicRoom(room) {
  return {
    code: room.code,
    host: room.host,
    state: room.state,
    mode: room.mode,
    customTimeLimit: room.customTimeLimit || null,
    isDaily: room.isDaily || false,
    round: room.round,
    totalRounds: room.locations.length,
    guessCount: room.roundAnswers.size,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score
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
      id: p.id, name: p.name, avatar: p.avatar, totalScore: p.score,
      roundPts: ans?.pts ?? 0,
      guess: ans ? { lat: ans.lat, lng: ans.lng } : null,
      km: ans ? Math.round(ans.km) : null,
    };
  }).sort((a, b) => b.roundPts - a.roundPts);

  io.to(room.code).emit('round-results', {
    results,
    answer: { lat: loc.lat, lng: loc.lng, name: loc.name, city: loc.city, fact: loc.fact, gradient: loc.gradient, icon: loc.icon, wikiTitle: loc.wikiTitle },
    isLast: room.round >= room.locations.length - 1,
    room: publicRoom(room),
  });
}

function finishGame(room) {
  room.state = 'finished';
  const final = Array.from(room.players.values()).sort((a, b) => b.score - a.score);
  io.to(room.code).emit('game-over', { final, room: publicRoom(room) });
}

// ── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('create-room', ({ name, mode = 'classic', avatar }) => {
    if (!name?.trim()) return;
    const code = genCode();
    const room = {
      code, host: socket.id, players: new Map(), state: 'lobby',
      mode, locations: pickLocations(mode), customTimeLimit: null,
      round: 0, roundAnswers: new Map(),
      roundTimer: null, roundStart: 0, clueTimers: [],
    };
    const av = avatar || defaultAvatar(name);
    room.players.set(socket.id, { id:socket.id, name:name.trim(), avatar:av, score:0 });
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', { code, room: publicRoom(room) });
  });

  socket.on('join-room', ({ code, name, avatar }) => {
    const room = rooms.get((code||'').toUpperCase().trim());
    if (!room) return socket.emit('join-error', 'Room not found. Check the code and try again.');
    if (room.state !== 'lobby') return socket.emit('join-error', 'This game is already in progress.');
    if (room.players.size >= 8) return socket.emit('join-error', 'Room is full (8 players max).');
    const av = avatar || defaultAvatar(name);
    room.players.set(socket.id, { id:socket.id, name:(name||'?').trim(), avatar:av, score:0 });
    socket.join(code);
    socket.emit('room-joined', { code, room: publicRoom(room) });
    socket.to(room.code).emit('player-joined', { name:(name||'?').trim(), avatar:av, room: publicRoom(room) });
  });

  socket.on('change-mode', ({ code, mode }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.mode = mode;
    room.customTimeLimit = null;
    room.locations = pickLocations(mode);
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('change-time', ({ code, timeLimit }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.customTimeLimit = timeLimit;
    io.to(code).emit('room-updated', { room: publicRoom(room) });
  });

  socket.on('start-game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
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
    if (room.round >= room.locations.length) finishGame(room);
    else beginRound(room);
  });

  socket.on('play-again', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby';
    room.round = 0;
    room.locations = pickLocations(room.mode);
    room.roundAnswers.clear();
    room.players.forEach(p => { p.score = 0; });
    io.to(code).emit('room-updated', { room: publicRoom(room) });
    io.to(code).emit('back-to-lobby', { room: publicRoom(room) });
  });

  socket.on('start-daily', ({ name, avatar }) => {
    if (!name?.trim()) return;
    const code = genCode();
    const av = avatar || defaultAvatar(name);
    const room = {
      code, host: socket.id, players: new Map(), state: 'lobby',
      mode: 'classic', locations: getDailyLocations(), customTimeLimit: null,
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
