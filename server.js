const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { LOCATIONS_ALL, UNITS } = require('./locations');
const { PSYCHOLOGISTS } = require('./public/avatars.js');

// Persistent data dir (set DATA_DIR to a Railway volume mount so accounts
// survive redeploys; falls back to the project folder for local dev).
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Wikipedia image URL cache (resolves once, ships URL with round-start) ─────
const IMG_CACHE_FILE = path.join(DATA_DIR, 'image-cache.json');
let imageCache = {};
try { imageCache = JSON.parse(fs.readFileSync(IMG_CACHE_FILE, 'utf8')) || {}; } catch {}
let imageCacheDirty = false;
function saveImageCache() {
  if (!imageCacheDirty) return;
  try { fs.writeFileSync(IMG_CACHE_FILE, JSON.stringify(imageCache)); imageCacheDirty = false; } catch {}
}
setInterval(saveImageCache, 15000).unref?.();
process.on('SIGTERM', saveImageCache);
process.on('SIGINT', saveImageCache);

function wikiEnc(t) {
  t = String(t || '').replace(/ /g, '_');
  try { return encodeURIComponent(decodeURIComponent(t)); } catch { return encodeURIComponent(t); }
}
const WIKI_HEADERS = { 'User-Agent': 'PsychoGuesser/1.0 (https://psychoguesser.com)' };

async function resolveImageUrl(wikiTitle) {
  if (!wikiTitle) return null;
  if (imageCache[wikiTitle] !== undefined) return imageCache[wikiTitle];
  const enc = wikiEnc(wikiTitle);
  let src = null;
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`, { headers: WIKI_HEADERS });
    if (r.ok) { const d = await r.json(); src = d?.originalimage?.source || d?.thumbnail?.source || null; }
  } catch {}
  if (!src) {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${enc}`, { headers: WIKI_HEADERS });
      if (r.ok) {
        const d = await r.json();
        const it = (d.items || []).find(i => i.type === 'image' && i.srcset && i.srcset.length);
        if (it) { let s = it.srcset[it.srcset.length - 1].src; src = s.startsWith('//') ? 'https:' + s : s; }
      }
    } catch {}
  }
  imageCache[wikiTitle] = src;
  imageCacheDirty = true;
  return src;
}

// Background prefetch of every location image on startup (slow-trickle, no spam).
(async () => {
  const titles = [...new Set(LOCATIONS_ALL.map(l => l.wikiTitle))];
  for (const t of titles) {
    if (imageCache[t] !== undefined) continue;
    await resolveImageUrl(t);
    await new Promise(r => setTimeout(r, 80));
  }
  saveImageCache();
})();

// ── Daily Challenge ────────────────────────────────────────────────────────────
const SCORES_FILE = path.join(DATA_DIR, 'daily-scores.json');

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
const COMMUNITY_FILE = path.join(DATA_DIR, 'community-locations.json');

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

// ── Accounts / Auth ────────────────────────────────────────────────────────────
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch { return { users: {}, usernames: {}, tokens: {} }; }
}
function writeAccounts(d) { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(d, null, 2)); }

function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function pwMatches(pw, salt, hash) {
  const a = Buffer.from(hashPw(pw, salt), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
function publicUser(u) { return { username: u.username, email: u.email, games: u.games || 0, xp: u.xp || 0, createdAt: u.createdAt, unitXp: u.unitXp || {}, unitGames: u.unitGames || {} }; }

app.post('/api/auth/register', (req, res) => {
  let { email, username, password } = req.body || {};
  email = (email || '').trim().toLowerCase();
  username = (username || '').trim();
  password = password || '';
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (username.length < 3 || username.length > 18) return res.status(400).json({ error: 'Username must be 3-18 characters.' });
  if (isBadName(username)) return res.status(400).json({ error: 'That username isn\'t allowed. Please pick another.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const d = readAccounts();
  if (d.users[email]) return res.status(400).json({ error: 'An account with that email already exists.' });
  if (d.usernames[username.toLowerCase()]) return res.status(400).json({ error: 'That username is already taken.' });
  const salt = crypto.randomBytes(16).toString('hex');
  d.users[email] = { email, username, salt, hash: hashPw(password, salt), createdAt: Date.now(), games: 0, xp: 0 };
  d.usernames[username.toLowerCase()] = email;
  const token = newToken();
  d.tokens[token] = email;
  writeAccounts(d);
  res.json({ ok: true, token, user: publicUser(d.users[email]) });
});

app.post('/api/auth/login', (req, res) => {
  let { email, password } = req.body || {};
  email = (email || '').trim().toLowerCase();
  password = password || '';
  const d = readAccounts();
  const u = d.users[email];
  if (!u || !pwMatches(password, u.salt, u.hash)) return res.status(400).json({ error: 'Incorrect email or password.' });
  const token = newToken();
  d.tokens[token] = email;
  writeAccounts(d);
  res.json({ ok: true, token, user: publicUser(u) });
});

app.post('/api/auth/me', (req, res) => {
  const { token } = req.body || {};
  const d = readAccounts();
  const email = d.tokens[token];
  if (!email || !d.users[email]) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ ok: true, user: publicUser(d.users[email]) });
});

app.post('/api/auth/logout', (req, res) => {
  const { token } = req.body || {};
  const d = readAccounts();
  if (token && d.tokens[token]) { delete d.tokens[token]; writeAccounts(d); }
  res.json({ ok: true });
});

app.get('/api/leaderboard', (req, res) => {
  const d = readAccounts();
  const top = Object.values(d.users)
    .map(u => ({ username: u.username, xp: u.xp || 0, games: u.games || 0 }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 25);
  res.json({ top });
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
const socketAccounts = new Map(); // socket.id -> account email (for crediting stats)

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
  // Balanced exponential decay. Being in the right city/region scores well.
  // ~50km: 4400, ~150km: 3500, ~300km: 2400, ~600km: 1100, ~1200km: 250
  const distScore = Math.round(5000 * Math.exp(-km / 450));
  // Speed bonus scales with accuracy, so a far/wrong guess earns ~0 even if fast.
  const accuracy = distScore / 5000;
  const timeBonus = timeLimit < 999 ? Math.round(accuracy * Math.max(0, timeLimit - elapsedSec) * 5) : 0;
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
  // Ease players in: lead with one or two iconic / widely-known locations,
  // then fill the rest randomly. (Feedback: questions felt hard up front.)
  const iconic = pool.filter(l => l.iconic).sort(() => Math.random()-0.5);
  const rest   = pool.filter(l => !l.iconic).sort(() => Math.random()-0.5);
  const lead = Math.min(n <= 3 ? 1 : 2, iconic.length);
  const shuffled = [...iconic.slice(0, lead), ...rest];
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
  const colors = ['#ff6b3d','#ff9d3c','#ff4d8d','#ffb648','#e0552e','#ff7a59','#d6336c','#ffd0b0'];
  let h = 0;
  for (const c of (name||'?')) h = ((h<<5)-h) + c.charCodeAt(0);
  const initials = (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return { initials, color: colors[Math.abs(h) % colors.length], label: name };
}

function takenAvatarIds(room) {
  const s = new Set();
  for (const p of room.players.values()) if (p.avatar && p.avatar.id) s.add(p.avatar.id);
  return s;
}

// Ensures each player in a room has a distinct psychologist avatar.
function uniqueAvatar(room, requested) {
  const taken = takenAvatarIds(room);
  if (requested && requested.id && !taken.has(requested.id)) return requested;
  const free = PSYCHOLOGISTS.find(p => !taken.has(p.id));
  return free ? { ...free } : requested;
}

function nameTaken(room, n) {
  const low = n.toLowerCase();
  for (const p of room.players.values()) if ((p.name || '').toLowerCase() === low) return true;
  return false;
}

// Ensures each player in a room has a distinct name (auto-suffix duplicates).
function uniqueName(room, name) {
  const base = (name || 'Player').trim().slice(0, 18) || 'Player';
  if (!nameTaken(room, base)) return base;
  for (let i = 2; i <= 30; i++) {
    const cand = `${base} (${i})`;
    if (!nameTaken(room, cand)) return cand;
  }
  return `${base} ${Math.floor(Math.random() * 1000)}`;
}

// ── Team / Duel helpers ───────────────────────────────────────────────────────
const DUEL_HP = 5000;
const MAX_ROUND_DAMAGE = 2500; // a single round can take at most half a health bar
const TEAM_MAX = 10; // max players per team in team battle mode

function roundMultiplier(roundIndexZeroBased) {
  // Rounds 1-3 = x1, then +0.5 each round (r4=1.5, r5=2, r6=2.5 ...)
  const n = roundIndexZeroBased + 1;
  return n <= 3 ? 1 : 1 + (n - 3) * 0.5;
}

function distPoints(km) {
  return Math.round(5000 * Math.exp(-km / 450));
}

// Coarse region hint (the country) derived from a location's city string.
function regionHint(city) {
  const parts = String(city || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'Unknown';
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
  room.hintsUsed = new Set();
  room.roundStart = Date.now();
  const loc = room.locations[room.round];
  const tl = timeLimitFor(room);

  const nextLoc = room.locations[room.round + 1];
  io.to(room.code).emit('round-start', {
    round: room.round + 1,
    totalRounds: room.locations.length,
    timeLimit: tl,
    mode: room.mode,
    gradient: loc.gradient,
    icon: loc.icon,
    wikiTitle: loc.wikiTitle,
    imageUrl: imageCache[loc.wikiTitle] || null,
    nextImageUrl: nextLoc ? (imageCache[nextLoc.wikiTitle] || null) : null,
    clue: loc.clues[0],
    hintRegion: regionHint(loc.city),
    room: publicRoom(room),
  });
  // If current image isn't cached yet, resolve it lazily and push when ready.
  if (loc.wikiTitle && !imageCache[loc.wikiTitle]) {
    resolveImageUrl(loc.wikiTitle).then(url => {
      if (url && room.state === 'round') io.to(room.code).emit('image-ready', { wikiTitle: loc.wikiTitle, imageUrl: url });
    });
  }
  // Warm the next-round image in the background regardless.
  if (nextLoc && nextLoc.wikiTitle && !imageCache[nextLoc.wikiTitle]) resolveImageUrl(nextLoc.wikiTitle);

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
      // Damage is based on how far off the LOSING team's best guess was.
      // distPoints range 0 (across the world) .. 5000 (bullseye), so the
      // "miss" = 5000 - loserPoints. A far guess hurts a lot regardless of
      // the multiplier; the multiplier just scales the stakes each round.
      const loserPoints = Math.min(a.points, b.points);
      damage = Math.min(MAX_ROUND_DAMAGE, Math.round((5000 - loserPoints) * mult));
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

function creditAccounts(room) {
  // Credit games played + XP to any logged-in players when a game ends.
  const updates = [];
  for (const p of room.players.values()) {
    const email = socketAccounts.get(p.id);
    if (email) updates.push([email, p.score || 0]);
  }
  if (!updates.length) return;
  const unit = room.isDaily ? 'daily' : (room.mode === 'community' ? 'community' : (room.unit || 'all'));
  try {
    const d = readAccounts();
    let changed = false;
    for (const [email, score] of updates) {
      const u = d.users[email];
      if (u) {
        u.games = (u.games || 0) + 1;
        u.xp = (u.xp || 0) + score;
        if (!u.unitXp) u.unitXp = {};
        if (!u.unitGames) u.unitGames = {};
        u.unitXp[unit] = (u.unitXp[unit] || 0) + score;
        u.unitGames[unit] = (u.unitGames[unit] || 0) + 1;
        changed = true;
      }
    }
    if (changed) writeAccounts(d);
  } catch {}
}

function finishGame(room) {
  room.state = 'finished';
  creditAccounts(room);
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
  // Associate this socket with a logged-in account (for crediting games/XP).
  socket.on('auth', ({ token }) => {
    if (!token) { socketAccounts.delete(socket.id); return; }
    const d = readAccounts();
    const email = d.tokens[token];
    if (email && d.users[email]) socketAccounts.set(socket.id, email);
    else socketAccounts.delete(socket.id);
  });

  socket.on('create-room', ({ name, mode = 'classic', avatar, unit = 'all' }) => {
    if (!name?.trim()) return;
    if (isBadName(name)) return socket.emit('name-error', 'Please choose a different name, that one isn\'t allowed.');
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
    if (isBadName(name)) return socket.emit('join-error', 'Please choose a different name, that one isn\'t allowed.');
    const room = rooms.get((code||'').toUpperCase().trim());
    if (!room) return socket.emit('join-error', 'Room not found. Check the code and try again.');
    if (room.state !== 'lobby') return socket.emit('join-error', 'This game is already in progress.');
    if (room.players.size >= 20) return socket.emit('join-error', 'Room is full (20 players max).');
    const av = uniqueAvatar(room, avatar || defaultAvatar(name));
    const avatarReassigned = !!(avatar && avatar.id && av.id && av.id !== avatar.id);
    const requestedName = (name || '?').trim();
    const finalName = uniqueName(room, requestedName);
    const nameReassigned = finalName !== requestedName;
    let joinTeam = null;
    if (room.teamMode) { const c = teamCounts(room); joinTeam = c.A <= c.B ? 'A' : 'B'; }
    room.players.set(socket.id, { id:socket.id, name:finalName, avatar:av, score:0, team:joinTeam });
    socket.join(code);
    socket.emit('room-joined', { code, room: publicRoom(room), yourAvatar: av, avatarReassigned, yourName: finalName, nameReassigned });
    socket.to(room.code).emit('player-joined', { name:finalName, avatar:av, room: publicRoom(room) });
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

  socket.on('use-hint', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'round') return;
    if (room.roundAnswers.has(socket.id)) return; // can't hint after guessing
    if (room.hintsUsed) room.hintsUsed.add(socket.id);
  });

  socket.on('set-team', ({ code, team }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'lobby') return;
    if (team !== 'A' && team !== 'B') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    if (p.team !== team && teamCounts(room)[team] >= TEAM_MAX) {
      return socket.emit('start-error', `Team ${team} is full (max ${TEAM_MAX} players).`);
    }
    p.team = team;
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
    let pts = calcScore(km, elapsed, timeLimitFor(room));
    const usedHint = room.hintsUsed && room.hintsUsed.has(socket.id);
    if (usedHint) pts = Math.round(pts * 0.5); // hint penalty: half points this round
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
    if (isBadName(name)) return socket.emit('name-error', 'Please choose a different name, that one isn\'t allowed.');
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
    socketAccounts.delete(socket.id);
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
