'use strict';
// Serveur BMX World Pronos : Node.js seul, aucune dépendance à installer.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./rules');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

// ---------- Données (fichier JSON) ----------
// db.seasons : une entrée par saison, avec son calendrier, ses résultats et ses pronostics.
let db = { version: 2, users: [], sessions: {}, settings: { registration: true, currentSeason: null }, seasons: [] };
if (fs.existsSync(DATA_FILE)) {
  const old = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (old.version === 2) {
    db = old;
  } else {
    // Ancien format (saison 2026 unique) : on le range dans une saison
    const races = R.calendar2026().map((r) => ({ ...r, ...((old.races || {})[r.id] || {}) }));
    db.users = old.users || [];
    db.settings.registration = old.settings ? old.settings.registration !== false : true;
    db.seasons = [{ id: '2026', name: '2026', jokers: old.settings ? old.settings.jokers !== false : true, races, pronos: old.pronos || {} }];
  }
}
if (!db.seasons.length) db.seasons.push({ id: '2026', name: '2026', jokers: true, races: R.calendar2026(), pronos: {} });
if (!db.seasons.some((s) => s.id === db.settings.currentSeason)) db.settings.currentSeason = db.seasons[db.seasons.length - 1].id;

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const newId = () => crypto.randomBytes(6).toString('hex');
const currentSeason = () => db.seasons.find((s) => s.id === db.settings.currentSeason);

// ---------- Outils ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100000) reject(new HttpError(413, 'Requête trop volumineuse.'));
    });
    req.on('end', () => {
      try {
        const body = data ? JSON.parse(data) : {};
        resolve(body && typeof body === 'object' ? body : {});
      } catch {
        reject(new HttpError(400, 'Requête invalide.'));
      }
    });
    req.on('error', reject);
  });
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ---------- Authentification ----------
// Mots de passe : jamais stockés, seulement leur empreinte scrypt avec un sel par joueur.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function setPassword(user, password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 100) fail(400, `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
  user.salt = crypto.randomBytes(16).toString('hex');
  user.hash = hashPassword(password, user.salt);
}
function checkPassword(user, password) {
  const a = Buffer.from(hashPassword(String(password || ''), user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Sessions : jeton aléatoire dans un cookie HttpOnly ; le serveur n'en garde que l'empreinte.
const tokenKey = (token) => crypto.createHash('sha256').update(token).digest('hex');
const cookieToken = (req) => (/(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '') || [])[1];
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
function sessionCookie(req, token, maxAge) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function currentUser(req) {
  const token = cookieToken(req);
  const key = token && tokenKey(token);
  const session = key && db.sessions[key];
  if (!session) return null;
  if (Date.now() > session.expires) {
    delete db.sessions[key];
    return null;
  }
  return db.users.find((u) => u.id === session.userId) || null;
}
function openSession(req, res, user) {
  const now = Date.now();
  for (const key in db.sessions) if (db.sessions[key].expires < now) delete db.sessions[key];
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[tokenKey(token)] = { userId: user.id, expires: now + SESSION_DAYS * 86400000 };
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
}
function closeSessions(userId, exceptKey) {
  for (const key in db.sessions) if (db.sessions[key].userId === userId && key !== exceptKey) delete db.sessions[key];
}

// Derrière un hébergeur (TRUST_PROXY=1), l'adresse du visiteur est la dernière ajoutée par le proxy dans X-Forwarded-For
function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress;
}

// Anti force brute : blocage temporaire après trop d'échecs
const WINDOW = 15 * 60000;
const attempts = new Map();
function checkThrottle(key) {
  const entry = attempts.get(key);
  if (entry && entry.until > Date.now()) fail(429, `Trop de tentatives. Réessaie dans ${Math.ceil((entry.until - Date.now()) / 60000)} min.`);
}
function recordFailure(key, max) {
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW) entry = { first: now, count: 0, until: 0 };
  if (++entry.count >= max) Object.assign(entry, { until: now + WINDOW, count: 0, first: now });
  attempts.set(key, entry);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now && now - entry.first > WINDOW) attempts.delete(key);
}, WINDOW).unref();

function cleanName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 30) fail(400, 'Le pseudo doit faire entre 2 et 30 caractères.');
  return name;
}

// ---------- Courses ----------
function isLocked(season, race) {
  return season.id !== db.settings.currentSeason || R.hasResults(race) || Boolean(race.deadline && Date.now() >= Date.parse(race.deadline));
}
// Valide les podiums saisis : par catégorie, soit vide, soit 3 pilotes différents
function cleanPodiums(race, input) {
  const out = {};
  for (const cat of R.catsOf(race)) {
    const raw = input && Array.isArray(input[cat]) ? input[cat] : [];
    const names = [0, 1, 2].map((i) => String(raw[i] || '').replace(/\s+/g, ' ').trim().slice(0, 60));
    if (names.every((n) => !n)) continue;
    const label = R.CATS[cat].label;
    if (names.some((n) => !R.norm(n))) fail(400, `${label} : il faut 3 pilotes (ou laisser la catégorie vide).`);
    if (new Set(names.map(R.norm)).size < 3) fail(400, `${label} : les 3 pilotes doivent être différents.`);
    out[cat] = names;
  }
  return out;
}
// Valide les informations de calendrier d'une course
function applyRaceInfo(race, body) {
  if ('city' in body) {
    race.city = String(body.city || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!race.city) fail(400, 'La ville est obligatoire.');
  }
  if ('country' in body) {
    race.country = String(body.country || '').trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(race.country)) fail(400, 'Le pays doit être un code de 2 ou 3 lettres (ex : FRA).');
  }
  if ('date' in body) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date))) fail(400, 'Date de course invalide.');
    race.date = body.date;
  }
  if ('block' in body) {
    race.block = Number(body.block);
    if (!Number.isInteger(race.block) || race.block < 1 || race.block > 20) fail(400, 'Le bloc doit être un nombre entre 1 et 20.');
  }
  if (race.type === 'wc' && 'round' in body) {
    race.round = Number(body.round);
    if (!Number.isInteger(race.round) || race.round < 1 || race.round > 99) fail(400, 'Le numéro de manche doit être entre 1 et 99.');
  }
}

// ---------- État envoyé au navigateur ----------
function buildState(me, season) {
  const isCurrent = season.id === db.settings.currentSeason;
  // Saison en cours : tous les joueurs ; saison passée : ceux qui y ont joué
  const played = new Set(Object.values(season.pronos).flatMap((byUser) => Object.keys(byUser)));
  const players = db.users.filter((u) => isCurrent || played.has(u.id));
  const standings = R.computeStandings(players, season.races, season.pronos, season.jokers);

  // Suggestions de pilotes : résultats et pronostics visibles, toutes saisons confondues
  const riders = Object.fromEntries(Object.keys(R.CATS).map((c) => [c, new Map()]));
  const addRiders = (podiums) => {
    for (const cat in podiums || {}) for (const n of podiums[cat]) if (riders[cat] && !riders[cat].has(R.norm(n))) riders[cat].set(R.norm(n), n);
  };
  for (const s of db.seasons) {
    for (const race of s.races) {
      addRiders(race.results);
      const all = s.pronos[race.id] || {};
      for (const uid in all) if (uid === me.id || isLocked(s, race)) addRiders(all[uid].picks);
    }
  }

  const races = R.sortRaces(season.races).map((race) => {
    const all = season.pronos[race.id] || {};
    const locked = isLocked(season, race);
    // Article 6 : les pronostics des autres restent secrets jusqu'à l'heure limite
    const pronos = {};
    for (const uid in all) if (locked || uid === me.id) pronos[uid] = { picks: all[uid].picks, joker: all[uid].joker };
    return { ...race, name: R.raceName(race), cats: R.catsOf(race), locked, submitted: Object.keys(all), pronos, scores: standings.scores[race.id] || null };
  });
  return {
    me: { id: me.id, name: me.name, admin: me.admin },
    settings: { registration: db.settings.registration },
    seasons: db.seasons.map((s) => ({ id: s.id, name: s.name, current: s.id === db.settings.currentSeason })),
    season: { id: season.id, name: season.name, jokers: season.jokers, current: isCurrent },
    cats: R.CATS,
    blocks: R.blocksOf(season.races),
    races,
    players: db.users.map((u) => ({ id: u.id, name: u.name, admin: u.admin })),
    standings: { general: standings.general, blocks: standings.blocks },
    jokerUsage: R.jokerUsage(season.races, season.pronos, me.id, null),
    riders: Object.fromEntries(Object.entries(riders).map(([c, m]) => [c, [...m.values()].sort((a, b) => a.localeCompare(b))])),
  };
}

// ---------- API ----------
async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  if (req.method !== 'GET') {
    // Anti-CSRF : une requête qui modifie des données doit venir de l'application elle-même
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) fail(403, 'Origine de la requête refusée.');
    if (!/^application\/json/.test(req.headers['content-type'] || '')) fail(415, 'Requête invalide.');
  }
  const body = req.method === 'GET' ? {} : await readBody(req);
  const ipKey = 'ip:' + clientIp(req);

  if (route === 'POST /api/register') {
    checkThrottle(ipKey);
    if (db.users.length > 0 && !db.settings.registration) fail(403, "Les inscriptions sont fermées par l'organisateur.");
    const name = cleanName(body.name);
    if (db.users.some((u) => R.norm(u.name) === R.norm(name))) fail(409, 'Ce pseudo est déjà pris.');
    // Le premier compte créé est celui de l'organisateur
    const user = { id: newId(), name, admin: db.users.length === 0, created: Date.now() };
    setPassword(user, body.password);
    recordFailure(ipKey, 20); // limite aussi les créations de comptes en rafale
    db.users.push(user);
    openSession(req, res, user);
    save();
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'POST /api/login') {
    const nameKey = 'name:' + R.norm(body.name);
    checkThrottle(ipKey);
    checkThrottle(nameKey);
    const user = db.users.find((u) => R.norm(u.name) === R.norm(body.name));
    if (!user || !checkPassword(user, body.password)) {
      recordFailure(nameKey, 5);
      recordFailure(ipKey, 30);
      fail(401, 'Pseudo ou mot de passe incorrect.');
    }
    attempts.delete(nameKey);
    openSession(req, res, user);
    save();
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'POST /api/logout') {
    const token = cookieToken(req);
    if (token) delete db.sessions[tokenKey(token)];
    save();
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return sendJson(res, 200, { ok: true });
  }

  const me = currentUser(req);
  if (!me) fail(401, 'Connexion requise.');

  if (route === 'GET /api/state') {
    const season = db.seasons.find((s) => s.id === url.searchParams.get('season')) || currentSeason();
    return sendJson(res, 200, buildState(me, season));
  }
  if (route === 'PUT /api/password') {
    const key = 'pwd:' + me.id;
    checkThrottle(key);
    if (!checkPassword(me, body.current)) {
      recordFailure(key, 5);
      fail(403, 'Mot de passe actuel incorrect.');
    }
    setPassword(me, body.password);
    closeSessions(me.id, tokenKey(cookieToken(req))); // déconnecte les autres appareils
    save();
    return sendJson(res, 200, { ok: true });
  }

  let m = /^PUT \/api\/pronos\/(\w+)$/.exec(route);
  if (m) {
    const season = currentSeason();
    const race = season.races.find((r) => r.id === m[1]) || fail(404, 'Course inconnue.');
    if (isLocked(season, race)) fail(403, "L'heure limite est passée : les pronostics sont verrouillés.");
    const picks = cleanPodiums(race, body.picks);
    if (!Object.keys(picks).length) fail(400, 'Remplis au moins une catégorie.');
    const mine = (season.pronos[race.id] = season.pronos[race.id] || {});
    let joker = mine[me.id] ? mine[me.id].joker : null;
    if (season.jokers && race.type === 'wc') {
      joker = body.joker || null;
      if (joker) {
        if (!R.WC_CATS.includes(joker)) fail(400, 'Joker invalide.');
        if (!R.jokerAllowed(R.jokerUsage(season.races, season.pronos, me.id, race.id), joker)) fail(400, `Tu n'as plus de joker disponible pour ${R.CATS[joker].label}.`);
      }
    }
    mine[me.id] = { picks, joker, updated: Date.now() };
    save();
    return sendJson(res, 200, { ok: true });
  }

  // ----- Organisateur uniquement -----
  if (!url.pathname.startsWith('/api/admin/')) fail(404, 'Route inconnue.');
  if (!me.admin) fail(403, "Réservé à l'organisateur.");

  if (route === 'PUT /api/admin/settings') {
    if (typeof body.registration === 'boolean') db.settings.registration = body.registration;
    save();
    return sendJson(res, 200, { ok: true });
  }

  // Saisons
  if (route === 'POST /api/admin/seasons') {
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 20) fail(400, 'Le nom de la saison doit faire entre 1 et 20 caractères (ex : 2027).');
    if (db.seasons.some((s) => R.norm(s.name) === R.norm(name))) fail(409, 'Une saison porte déjà ce nom.');
    // Le calendrier de la saison en cours sert de modèle (dates décalées d'un an, à corriger)
    const races = currentSeason().races.map((r) => ({ id: newId(), type: r.type, round: r.round, city: r.city, country: r.country, date: String(Number(r.date.slice(0, 4)) + 1) + r.date.slice(4), block: r.block, deadline: null, results: {} }));
    const season = { id: newId(), name, jokers: currentSeason().jokers, races, pronos: {} };
    db.seasons.push(season);
    save();
    return sendJson(res, 200, { ok: true, id: season.id });
  }
  m = /^(\w+) \/api\/admin\/seasons\/(\w+)(?:\/races(?:\/(\w+))?)?$/.exec(route);
  if (m) {
    const [, method, seasonId, raceId] = m;
    const season = db.seasons.find((s) => s.id === seasonId) || fail(404, 'Saison inconnue.');
    const onRaces = url.pathname.includes('/races');
    if (!onRaces && method === 'PUT') {
      if (typeof body.jokers === 'boolean') season.jokers = body.jokers;
      if (body.current === true) db.settings.currentSeason = season.id;
      if ('name' in body) {
        const name = String(body.name || '').replace(/\s+/g, ' ').trim();
        if (!name || name.length > 20) fail(400, 'Nom de saison invalide.');
        season.name = name;
      }
    } else if (!onRaces && method === 'DELETE') {
      if (season.id === db.settings.currentSeason) fail(400, 'Impossible de supprimer la saison en cours.');
      db.seasons = db.seasons.filter((s) => s !== season);
    } else if (onRaces && !raceId && method === 'POST') {
      if (!['wc', 'worlds'].includes(body.type)) fail(400, 'Type de course invalide.');
      const race = { id: newId(), type: body.type, round: null, city: '', country: '', date: '', block: 1, deadline: null, results: {} };
      applyRaceInfo(race, { city: body.city, country: body.country, date: body.date, block: body.block, round: body.round });
      season.races.push(race);
    } else if (raceId && (method === 'PUT' || method === 'DELETE')) {
      const race = season.races.find((r) => r.id === raceId) || fail(404, 'Course inconnue.');
      if (method === 'DELETE') {
        season.races = season.races.filter((r) => r !== race);
        delete season.pronos[race.id];
      } else {
        applyRaceInfo(race, body);
        if ('deadline' in body) {
          if (body.deadline && Number.isNaN(Date.parse(body.deadline))) fail(400, 'Date limite invalide.');
          race.deadline = body.deadline ? new Date(body.deadline).toISOString() : null;
        }
        if ('results' in body) race.results = cleanPodiums(race, body.results);
      }
    } else {
      fail(404, 'Route inconnue.');
    }
    save();
    return sendJson(res, 200, { ok: true });
  }

  // Joueurs
  m = /^(PUT|DELETE) \/api\/admin\/users\/(\w+)$/.exec(route);
  if (m) {
    const user = db.users.find((u) => u.id === m[2]) || fail(404, 'Joueur inconnu.');
    if (m[1] === 'PUT') {
      setPassword(user, body.password);
      attempts.delete('name:' + R.norm(user.name));
    } else {
      if (user.id === me.id) fail(400, 'Impossible de supprimer ton propre compte.');
      db.users = db.users.filter((u) => u.id !== user.id);
      for (const s of db.seasons) for (const rid in s.pronos) delete s.pronos[rid][user.id];
    }
    if (user.id !== me.id) closeSessions(user.id);
    save();
    return sendJson(res, 200, { ok: true });
  }
  fail(404, 'Route inconnue.');
}

// ---------- Fichiers statiques ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(req, res, url) {
  let rel;
  try {
    rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    rel = '\0';
  }
  const file = path.join(PUBLIC_DIR, rel);
  if (rel.includes('\0') || !file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Introuvable');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    // En-têtes de sécurité : pas de script externe, pas d'affichage dans une autre page
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
      await api(req, res, url);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      sendJson(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Erreur du serveur.' });
    }
  })
  // HOST=127.0.0.1 : n'accepte que les connexions venant du serveur lui-même (reverse proxy devant)
  .listen(PORT, process.env.HOST || undefined, () => console.log(`BMX World Pronos : http://localhost:${PORT}`));
