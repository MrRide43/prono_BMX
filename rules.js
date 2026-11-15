'use strict';
// Règles du jeu, tirées du RÈGLEMENT UCI BMX WORLD PRONOS.
// Le calendrier (courses, dates, blocs) appartient à chaque saison ; les règles sont communes.

// Article 2 : catégories
const CATS = {
  EW: { label: 'Elites femmes', gender: 'W' },
  EM: { label: 'Elites hommes', gender: 'M' },
  UW: { label: 'U23 femmes', gender: 'W' },
  UM: { label: 'U23 hommes', gender: 'M' },
  JW: { label: 'Juniors femmes', gender: 'W' },
  JM: { label: 'Juniors hommes', gender: 'M' },
};
const WC_CATS = ['EW', 'EM', 'UW', 'UM'];
const JUNIOR_CATS = ['JW', 'JM'];
// Coupe du monde : 4 catégories ; championnat du monde : + les Juniors
const TYPE_CATS = { wc: WC_CATS, worlds: [...WC_CATS, ...JUNIOR_CATS] };

const catsOf = (race) => TYPE_CATS[race.type];
const raceName = (race) => (race.type === 'wc' ? `Coupe du monde - manche ${race.round}` : 'Championnat du monde');
const hasResults = (race) => Object.keys(race.results || {}).length > 0;
// Courses dans l'ordre chronologique
const sortRaces = (races) => [...races].sort((a, b) => a.date.localeCompare(b.date) || (a.round || 0) - (b.round || 0));
// Article 4 : blocs déduits des courses
function blocksOf(races) {
  const sorted = sortRaces(races);
  return [...new Set(sorted.map((r) => r.block))]
    .sort((a, b) => a - b)
    .map((id) => ({ id, label: 'Bloc ' + id, races: sorted.filter((r) => r.block === id).map((r) => r.id) }));
}

// Article 4 : calendrier de la saison 2026 (sert de première saison)
function calendar2026() {
  const wc = (round, city, country, date, block) => ({ id: 'cdm' + round, type: 'wc', round, city, country, date, block, deadline: null, results: {} });
  return [
    wc(1, 'Sarrians', 'FRA', '2026-06-06', 1),
    wc(2, 'Sarrians', 'FRA', '2026-06-07', 1),
    wc(3, 'Papendal', 'NED', '2026-06-13', 1),
    wc(4, 'Papendal', 'NED', '2026-06-14', 1),
    { id: 'worlds', type: 'worlds', round: null, city: 'Brisbane', country: 'AUS', date: '2026-07-18', block: 2, deadline: null, results: {} },
    wc(5, 'Pékin', 'CHI', '2026-10-03', 3),
    wc(6, 'Pékin', 'CHI', '2026-10-04', 3),
    wc(7, 'Pékin', 'CHI', '2026-10-10', 3),
    wc(8, 'Pékin', 'CHI', '2026-10-11', 3),
    wc(9, 'Sarasota', 'USA', '2026-10-31', 4),
    wc(10, 'Sarasota', 'USA', '2026-11-01', 4),
  ];
}

// Comparaison des noms de pilotes sans tenir compte de la casse ni des accents
function norm(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Article 3 : points d'une catégorie
const PODIUM_POINTS = [0, 2, 5, 10];
function scoreCategory(pick, result) {
  const res = result.map(norm);
  const p = pick.map(norm);
  const on = p.filter((n) => n && res.includes(n)).length;
  const placed = p.filter((n, i) => n && n === res[i]).length;
  return { on, placed, points: PODIUM_POINTS[on] + 2 * placed };
}

// Score d'un pronostiqueur sur une course (joker de l'article 5 si activé)
function scoreRace(race, prono, jokersOn) {
  const out = { points: 0, on: 0, junior: 0, cats: {} };
  if (!prono || !hasResults(race)) return out;
  for (const cat of catsOf(race)) {
    if (!race.results[cat] || !prono.picks || !prono.picks[cat]) continue;
    const s = scoreCategory(prono.picks[cat], race.results[cat]);
    s.doubled = Boolean(jokersOn && race.type === 'wc' && prono.joker === cat);
    if (s.doubled) s.points *= 2;
    out.cats[cat] = s;
    out.points += s.points;
    out.on += s.on;
    if (JUNIOR_CATS.includes(cat)) out.junior += s.points;
  }
  return out;
}

// Article 5 : 2 jokers par catégorie + 1 supplémentaire hommes + 1 supplémentaire femmes
function jokerUsage(races, pronos, userId, exceptRaceId) {
  const usage = { EW: 0, EM: 0, UW: 0, UM: 0 };
  for (const race of races) {
    if (race.type !== 'wc' || race.id === exceptRaceId) continue;
    const p = pronos[race.id] && pronos[race.id][userId];
    if (p && p.joker && usage[p.joker] !== undefined) usage[p.joker]++;
  }
  return usage;
}
function jokerAllowed(usage, cat) {
  const u = { ...usage, [cat]: usage[cat] + 1 };
  return u.EM <= 3 && u.UM <= 3 && u.EM + u.UM <= 5 && u.EW <= 3 && u.UW <= 3 && u.EW + u.UW <= 5;
}

// Article 8 : classements avec critères de départage
function rank(rows, cmp, started) {
  rows.sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    if (prev && cmp(prev, row) === 0) {
      row.rank = prev.rank;
      if (started) prev.tie = row.tie = true; // égalité parfaite : shi-fu-mi
    } else {
      row.rank = i + 1;
    }
  });
  return rows;
}

function computeStandings(users, races, pronos, jokersOn) {
  const sorted = sortRaces(races);
  const scores = {}; // scores[raceId][userId]
  for (const race of sorted.filter(hasResults)) {
    scores[race.id] = {};
    for (const u of users) scores[race.id][u.id] = scoreRace(race, (pronos[race.id] || {})[u.id], jokersOn);
  }
  const pts = (uid, rid) => (scores[rid] ? scores[rid][uid].points : 0);
  const on = (uid, rid) => (scores[rid] ? scores[rid][uid].on : 0);
  const junior = (uid, rid) => (scores[rid] ? scores[rid][uid].junior : 0);
  const rowsFor = (raceIds) =>
    users.map((u) => ({
      userId: u.id,
      name: u.name,
      perRace: Object.fromEntries(raceIds.map((rid) => [rid, pts(u.id, rid)])),
      total: raceIds.reduce((s, rid) => s + pts(u.id, rid), 0),
    }));

  const blocks = {};
  for (const block of blocksOf(sorted)) {
    const recent = [...block.races].reverse();
    const cmp = (a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (recent.length === 1) {
        // Bloc d'une seule course : pilotes sur le podium, puis points des catégories Juniors
        const rid = recent[0];
        return on(b.userId, rid) - on(a.userId, rid) || junior(b.userId, rid) - junior(a.userId, rid);
      }
      for (const rid of recent) if (pts(b.userId, rid) !== pts(a.userId, rid)) return pts(b.userId, rid) - pts(a.userId, rid);
      for (const rid of recent) if (on(b.userId, rid) !== on(a.userId, rid)) return on(b.userId, rid) - on(a.userId, rid);
      return 0;
    };
    const started = block.races.some((rid) => scores[rid]);
    blocks[block.id] = { started, complete: block.races.every((rid) => scores[rid]), rows: rank(rowsFor(block.races), cmp, started) };
  }

  // Général : points du championnat du monde, puis manches de la dernière à la première
  const recentOf = (type) => sorted.filter((r) => r.type === type).map((r) => r.id).reverse();
  const tiebreak = [...recentOf('worlds'), ...recentOf('wc')];
  const cmpGeneral = (a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    for (const rid of tiebreak) if (pts(b.userId, rid) !== pts(a.userId, rid)) return pts(b.userId, rid) - pts(a.userId, rid);
    return 0;
  };
  const started = Object.keys(scores).length > 0;
  const general = { started, complete: sorted.length > 0 && sorted.every(hasResults), rows: rank(rowsFor(sorted.map((r) => r.id)), cmpGeneral, started) };
  return { scores, general, blocks };
}

module.exports = { CATS, WC_CATS, TYPE_CATS, catsOf, raceName, hasResults, sortRaces, blocksOf, calendar2026, norm, scoreCategory, scoreRace, jokerUsage, jokerAllowed, computeStandings };
