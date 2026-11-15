'use strict';
// Interface BMX World Pronos (aucun framework).
let S = null; // état reçu du serveur
let authMode = 'login';
let seasonId = null; // saison affichée (null = saison en cours)
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

// ---------- Outils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const frDate = (d) => d.split('-').reverse().join('/');
const frDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const shortName = (race) => (race.type === 'wc' ? 'M' + race.round : 'CM');
const ordinal = (n) => (n === 1 ? '1er' : n + 'e');
const playerName = (id) => (S.players.find((p) => p.id === id) || {}).name || '?';

let toastTimer;
function toast(message, isError) {
  toastEl.textContent = message;
  toastEl.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ''), 3500);
}
async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur'), { status: res.status });
  return data;
}
async function refresh() {
  try {
    S = await call('GET', '/api/state' + (seasonId ? '?season=' + encodeURIComponent(seasonId) : ''));
  } catch (err) {
    S = null;
    if (err.status !== 401) toast(err.message, true);
  }
  render();
}
// Envoie une action puis recharge l'état
async function act(method, url, body, okMessage) {
  try {
    await call(method, url, body);
    if (okMessage) toast(okMessage);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

const seasonApi = () => `/api/admin/seasons/${S.season.id}`;

// Article 5 : jokers
const jokerAllowed = (usage, cat) => {
  const u = { ...usage, [cat]: usage[cat] + 1 };
  return u.EM <= 3 && u.UM <= 3 && u.EM + u.UM <= 5 && u.EW <= 3 && u.UW <= 3 && u.EW + u.UW <= 5;
};

// Article 7 : récompenses et gages
const BLOCK_REWARDS = {
  1: 'Se fait payer 2 verres par le 7e + porte-clé de vainqueur du bloc',
  2: 'Se fait payer 2 verres par le 6e',
  3: 'Se fait payer 1 verre par le 5e',
  4: 'Ne se fait rien payer et ne paye rien à personne',
  5: 'Paye 1 verre au 3e',
  6: 'Paye 2 verres au 2e',
  7: 'Paye 2 verres au 1er + une planche commune pour grignoter',
};
const SEASON_REWARDS = {
  1: 'Tee-shirt floqué + porte-clé vainqueur de la saison + 2 bières Pleine Lune',
  2: 'Porte-clé 2e de la saison + 1 bière Pleine Lune',
  3: 'Porte-clé 3e de la saison',
};

// ---------- Composants ----------
function plate(race) {
  return race.type === 'wc' ? `<div class="plate">${race.round}</div>` : '<div class="plate worlds">CM</div>';
}
function statusTag(race) {
  if (Object.keys(race.results).length) return '<span class="tag done">Résultats</span>';
  return race.locked ? '<span class="tag locked">Verrouillé</span>' : '<span class="tag open">Ouvert</span>';
}
function podiumInputs(race, prefix, values) {
  const lists = race.cats.map((c) => `<datalist id="dl-${c}">${S.riders[c].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`).join('');
  const cats = race.cats
    .map(
      (c) => `<div class="cat"><h3>${esc(S.cats[c].label)}</h3>${[0, 1, 2]
        .map(
          (i) => `<div class="pos-row"><span class="pos p${i + 1}">${i + 1}</span>
          <input name="${prefix}-${c}-${i}" list="dl-${c}" maxlength="60" autocomplete="off" aria-label="${esc(S.cats[c].label)}, ${ordinal(i + 1)}" placeholder="Pilote ${ordinal(i + 1)}" value="${esc((values[c] || [])[i] || '')}"></div>`
        )
        .join('')}</div>`
    )
    .join('');
  return `${lists}<div class="cat-grid">${cats}</div>`;
}
function readPodiums(form, race, prefix) {
  return Object.fromEntries(race.cats.map((c) => [c, [0, 1, 2].map((i) => form.elements[`${prefix}-${c}-${i}`].value)]));
}

// ---------- Vues ----------
function viewAuth() {
  const login = authMode === 'login';
  return `<div class="auth">
    <div class="hero"><h1>BMX World<br><b>Pronos</b></h1><div class="stripe"></div><p class="muted">Pronostique les podiums de la coupe du monde et du championnat du monde UCI de BMX Race.</p></div>
    <div class="tabs"><a href="#" data-auth="login" class="${login ? 'on' : ''}">Connexion</a><a href="#" data-auth="register" class="${login ? '' : 'on'}">Inscription</a></div>
    <form class="panel" data-form="auth">
      <div class="field"><label for="f-name">Pseudo</label><input id="f-name" name="name" maxlength="30" required autocomplete="username"></div>
      <div class="field"><label for="f-pass">Mot de passe</label><input id="f-pass" name="password" type="password" ${login ? '' : 'minlength="8"'} maxlength="100" required autocomplete="${login ? 'current-password' : 'new-password'}"></div>
      ${login ? '' : `<p class="muted small">8 caractères minimum. Le tout premier compte créé est celui de l'organisateur.</p>`}
      <div class="actions"><button class="btn">${login ? 'Se connecter' : "S'inscrire"}</button></div>
    </form></div>`;
}

function viewJokers() {
  if (!S.season.jokers) return '';
  const u = S.jokerUsage;
  const chip = (label, used, max) => `<span class="joker-chip ${used >= max ? 'empty' : ''}">${label}<b>${max - used}/${max}</b></span>`;
  const extra = (a, b) => Math.max(0, u[a] - 2) + Math.max(0, u[b] - 2);
  return `<div class="panel"><h3>Mes jokers restants <span class="tag joker">×2</span></h3><div class="jokers">
    ${chip('Elites hommes', Math.min(u.EM, 2), 2)}${chip('U23 hommes', Math.min(u.UM, 2), 2)}${chip('Bonus hommes', extra('EM', 'UM'), 1)}
    ${chip('Elites femmes', Math.min(u.EW, 2), 2)}${chip('U23 femmes', Math.min(u.UW, 2), 2)}${chip('Bonus femmes', extra('EW', 'UW'), 1)}
    </div><p class="muted small" style="margin:10px 0 0">Un seul joker par manche de coupe du monde. Tout joker non utilisé sur une manche est définitivement perdu.</p></div>`;
}

function viewRaces() {
  const blocks = S.blocks
    .map((b) => {
      const races = S.races.filter((r) => r.block === b.id);
      const cards = races
        .map((r) => {
          const mine = r.pronos[S.me.id];
          const score = r.scores && r.scores[S.me.id];
          const pronoTag = mine ? '<span class="tag done">Prono envoyé</span>' : r.locked ? '<span class="tag done">Pas de prono</span>' : '<span class="tag todo">Prono à faire</span>';
          return `<a class="race-card" href="#/course/${r.id}">${plate(r)}
            <div class="info"><div class="city">${esc(r.city)} <span class="muted">${r.country}</span></div>
            <div class="muted">${esc(r.name)} · ${frDate(r.date)}</div>
            <div class="meta">${statusTag(r)}${pronoTag}</div></div>
            ${score ? `<div class="pts">${score.points}<small> pts</small></div>` : ''}</a>`;
        })
        .join('');
      return `<div class="block-title"><h2>${b.label}</h2><span>du ${frDate(races[0].date)} au ${frDate(races[races.length - 1].date)}</span></div><div class="race-grid">${cards}</div>`;
    })
    .join('');
  const archive = S.season.current ? '' : `<div class="panel"><b>Saison ${esc(S.season.name)} archivée.</b> <span class="muted">Les pronostics sont verrouillés ; résultats et classements restent consultables.</span></div>`;
  const empty = S.races.length ? '' : `<div class="panel"><p class="muted" style="margin:0">Aucune course au calendrier de cette saison pour l'instant.</p></div>`;
  return `<div class="page-head"><h1>Les courses</h1><span class="muted">Saison ${esc(S.season.name)}</span></div>${archive}${S.season.current ? viewJokers() : ''}${empty}${blocks}`;
}

function viewPronoForm(race) {
  const mine = race.pronos[S.me.id] || { picks: {}, joker: null };
  let joker = '';
  if (S.season.jokers && race.type === 'wc') {
    const usage = { ...S.jokerUsage };
    if (mine.joker) usage[mine.joker]--; // jokers posés sur les autres manches
    const options = race.cats
      .map((c) => `<option value="${c}" ${mine.joker === c ? 'selected' : ''} ${jokerAllowed(usage, c) ? '' : 'disabled'}>${esc(S.cats[c].label)}${jokerAllowed(usage, c) ? '' : ' (plus de joker)'}</option>`)
      .join('');
    joker = `<div class="field" style="max-width:340px;margin-top:16px"><label for="f-joker">Joker de la manche <span class="tag joker">×2</span></label>
      <select id="f-joker" name="joker"><option value="">Aucun joker (il sera perdu)</option>${options}</select></div>`;
  }
  return `<form class="panel" data-form="prono" data-race="${race.id}"><h2>Mon pronostic</h2>
    <p class="muted">Donne le podium de chaque catégorie, dans l'ordre. Modifiable jusqu'à l'heure limite ; personne ne voit ton pronostic avant.</p>
    ${podiumInputs(race, 'p', mine.picks)}${joker}
    <div class="actions"><button class="btn">${race.pronos[S.me.id] ? 'Modifier mon prono' : 'Envoyer mon prono'}</button></div></form>`;
}

function viewLockedPronos(race) {
  const hasResults = Object.keys(race.results).length > 0;
  const ids = Object.keys(race.pronos).sort((a, b) => ((race.scores?.[b]?.points || 0) - (race.scores?.[a]?.points || 0)) || playerName(a).localeCompare(playerName(b)));
  if (!ids.length) return '<div class="panel"><h2>Pronostics</h2><p class="muted">Aucun pronostic envoyé pour cette course.</p></div>';
  const cats = race.cats
    .map((c) => {
      const result = (race.results[c] || []).map(norm);
      const resultHtml = race.results[c]
        ? race.results[c].map((n, i) => `<div class="pos-row"><span class="pos p${i + 1}">${i + 1}</span><b>${esc(n)}</b></div>`).join('')
        : '<p class="muted small">Résultat en attente</p>';
      const players = ids
        .filter((id) => race.pronos[id].picks[c])
        .map((id) => {
          const p = race.pronos[id];
          const sc = race.scores?.[id]?.cats[c];
          const hasJoker = S.season.jokers && race.type === 'wc' && p.joker === c;
          const picks = p.picks[c]
            .map((n, i) => `<div class="pick ${result[i] === norm(n) ? 'placed' : result.includes(norm(n)) ? 'on' : ''}">${i + 1}. ${esc(n)}</div>`)
            .join('');
          return `<div class="player-pronos"><div class="head"><span>${esc(playerName(id))} ${hasJoker ? '<span class="tag joker">Joker ×2</span>' : ''}</span>${sc ? `<b>${sc.points}</b>` : ''}</div>${picks}</div>`;
        })
        .join('');
      return `<div class="cat"><h3>${esc(S.cats[c].label)}</h3>${resultHtml}${players}</div>`;
    })
    .join('');
  const totals = hasResults
    ? `<div class="chips" style="margin-bottom:14px">${ids.map((id) => `<span class="chip">${esc(playerName(id))} : <b>${race.scores[id].points} pts</b></span>`).join('')}</div>`
    : '';
  return `<div class="panel"><h2>${hasResults ? 'Résultats et pronostics' : 'Pronostics de tous les joueurs'}</h2>${totals}
    <div class="legend small muted"><span style="--c:var(--green)">Pilote bien placé</span><span style="--c:var(--orange)">Pilote sur le podium</span></div>
    <div class="cat-grid">${cats}</div></div>`;
}

function viewRaceAdmin(race) {
  if (!S.me.admin) return '';
  return `<div class="panel admin"><h2>Organisateur</h2>
    <form data-form="deadline" data-race="${race.id}">
      <div class="field" style="max-width:340px"><label for="f-deadline">Heure limite d'envoi des pronostics</label>
      <input id="f-deadline" name="deadline" type="datetime-local" value="${toLocalInput(race.deadline)}"></div>
      <div class="actions" style="margin-top:0"><button class="btn ghost">Enregistrer l'heure limite</button></div>
    </form>
    <form data-form="results" data-race="${race.id}" style="margin-top:22px">
      <h3 style="margin-bottom:6px">Podiums officiels</h3>
      <p class="muted small">Enregistrer des résultats verrouille les pronostics et met à jour les classements. Une catégorie peut rester vide en attendant.</p>
      ${podiumInputs(race, 'r', race.results)}
      <div class="actions"><button class="btn">Enregistrer les résultats</button>
      ${Object.keys(race.results).length ? '<button type="button" class="btn ghost danger" data-action="clear-results" data-race="' + race.id + '">Effacer les résultats</button>' : ''}</div>
    </form></div>`;
}

function viewRace(id) {
  const race = S.races.find((r) => r.id === id);
  if (!race) return viewRaces();
  const deadline = race.deadline ? `Heure limite : <b>${frDateTime(race.deadline)}</b>` : "Heure limite à préciser par l'organisateur";
  const submitted = `<div class="panel"><h3>Pronostics reçus : ${race.submitted.length}/${S.players.length}</h3><div class="chips">
    ${S.players.map((p) => `<span class="chip ${race.submitted.includes(p.id) ? 'ok' : 'muted'}">${race.submitted.includes(p.id) ? '✔' : '…'} ${esc(p.name)}</span>`).join('')}</div></div>`;
  return `<p><a href="#/courses">← Toutes les courses</a></p>
    <div class="page-head"><div style="display:flex;gap:14px;align-items:center">${plate(race)}
      <div><h1>${esc(race.city)} <span class="muted">${race.country}</span></h1>
      <div class="muted">${esc(race.name)} · ${frDate(race.date)} · Bloc ${race.block}</div></div></div>
      <div style="text-align:right">${statusTag(race)}<div class="muted small" style="margin-top:6px">${deadline}</div></div></div>
    ${race.locked ? viewLockedPronos(race) : viewPronoForm(race)}
    ${race.locked ? '' : submitted}
    ${viewRaceAdmin(race)}`;
}

function viewStandings(tab) {
  const block = S.blocks.find((b) => 'b' + b.id === tab);
  const data = block ? S.standings.blocks[block.id] : S.standings.general;
  const races = S.races.filter((r) => !block || r.block === block.id);
  const rewards = block ? BLOCK_REWARDS : SEASON_REWARDS;
  const tabs = `<div class="tabs"><a href="#/classement/general" class="${block ? '' : 'on'}">Général</a>
    ${S.blocks.map((b) => `<a href="#/classement/b${b.id}" class="${block === b ? 'on' : ''}">${b.label}</a>`).join('')}</div>`;
  const rows = data.rows
    .map(
      (row) => `<tr class="${row.userId === S.me.id ? 'me' : ''}">
      <td><div class="plate rank r${data.started ? row.rank : 0}">${data.started ? row.rank : '–'}</div></td>
      <td class="l name">${esc(row.name)} ${row.tie ? '<span class="tag locked" title="Égalité parfaite : départage au shi-fu-mi (puits interdit)">Shi-fu-mi</span>' : ''}</td>
      ${races.map((r) => `<td>${r.scores ? row.perRace[r.id] : '<span class="muted">·</span>'}</td>`).join('')}
      <td class="total">${row.total}</td>
      <td class="reward">${data.started && !row.tie ? esc(rewards[row.rank] || '') : ''}</td></tr>`
    )
    .join('');
  const intro = block
    ? `Cumul des points du bloc ${block.id}. ${data.complete ? 'Bloc terminé : récompenses et gages à régler au bar !' : 'Récompenses et gages provisoires tant que le bloc n\'est pas terminé.'}`
    : `Cumul des points de toutes les courses de la saison. ${data.complete ? 'Saison terminée !' : 'Récompenses provisoires jusqu\'à la fin de la saison.'}`;
  return `<div class="page-head"><h1>Classement</h1><span class="muted">Saison ${esc(S.season.name)}</span></div>${tabs}
    <div class="panel"><p class="muted">${intro}</p><div class="table-wrap"><table>
    <thead><tr><th>Rang</th><th class="l">Pronostiqueur</th>${races.map((r) => `<th title="${esc(r.name)} - ${esc(r.city)}">${shortName(r)}</th>`).join('')}<th>Total</th><th class="l">${block ? 'Récompense / gage' : 'Récompense'}</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function viewRules() {
  const blocks = S.blocks
    .map((b) => `<li><b>${b.label}</b> : ${S.races.filter((r) => r.block === b.id).map((r) => `${r.type === 'wc' ? ordinal(r.round) + ' manche' : 'Championnat du monde'} à ${esc(r.city)} (${r.country}) le ${frDate(r.date)}`).join(' ; ')}</li>`)
    .join('');
  const jokers = S.season.jokers
    ? `<p>Chaque pronostiqueur peut utiliser un joker pour <b>doubler ses points dans une catégorie</b> lors de chaque manche de coupe du monde (pas lors du championnat du monde), soit 10 jokers en tout. Exemple : 7 points sur une catégorie deviennent 14 points.</p>
      <p>Pas plus d'un joker par manche, et tout joker non utilisé est définitivement perdu. Les 10 jokers sont répartis ainsi :</p>
      <ul><li>2 jokers pour la catégorie Elites hommes</li><li>2 jokers pour la catégorie U23 hommes</li><li>1 joker supplémentaire pour une catégorie hommes (Elites ou U23)</li>
      <li>2 jokers pour la catégorie Elites femmes</li><li>2 jokers pour la catégorie U23 femmes</li><li>1 joker supplémentaire pour une catégorie femmes (Elites ou U23)</li></ul>
      <p class="app-note">Dans l'application : le joker se choisit en même temps que le pronostic, et le récapitulatif des jokers restants est affiché sur la page des courses.</p>`
    : `<p class="app-note">Les jokers sont désactivés par l'organisateur pour cette compétition.</p>`;
  const art = (n, title, html) => `<div class="panel"><h2>Article ${n} : ${title}</h2>${html}</div>`;
  const period = S.races.length
    ? `La compétition se déroule du ${frDate(S.races[0].date)} au ${frDate(S.races[S.races.length - 1].date)} et est découpée en ${S.blocks.length} bloc${S.blocks.length > 1 ? 's' : ''} :`
    : "Le calendrier de la saison n'est pas encore défini.";
  return `<div class="page-head"><h1>Règlement</h1><span class="muted">UCI BMX World Pronos ${esc(S.season.name)}</span></div><div class="rules">
    ${art(1, 'Critères de participation', `<p>Peut prendre part à cette compétition toute personne de plus de 30 ans faisant partie du groupe WhatsApp « Riders Potter » et ayant déjà pratiqué le BMX Race au Chabeuil BMX Club.</p>`)}
    ${art(2, 'Principe de la compétition', `<p>Les participants pronostiquent les <b>3 pilotes du podium</b> dans chaque catégorie des manches de la coupe du monde UCI de BMX Race et du championnat du monde : U23 femmes, U23 hommes, Elites femmes, Elites hommes, plus Juniors femmes et Juniors hommes pour le championnat du monde.</p>
      <p>Les points se cumulent tout au long de la saison. Le classement général est tenu à jour après chaque journée de compétition. Les 3 premiers de la saison sont récompensés, et des récompenses ou gages sont attribués à chaque bloc (article 7).</p>`)}
    ${art(3, 'Système de points', `<p>Pour chaque catégorie : 1 pilote sur le podium = 2 points, 2 pilotes = 5 points, 3 pilotes = 10 points. Chaque pilote correctement placé rapporte <b>2 points bonus</b>.</p>
      <ul><li>0 pilote sur le podium → 0 point</li><li>1 pilote sur le podium → 2 points</li><li>1 pilote sur le podium bien placé → 4 points</li><li>2 pilotes sur le podium → 5 points</li>
      <li>2 pilotes sur le podium dont 1 bien placé → 7 points</li><li>2 pilotes sur le podium bien placés → 9 points</li><li>3 pilotes sur le podium → 10 points</li>
      <li>3 pilotes sur le podium dont 1 bien placé → 12 points</li><li>3 pilotes sur le podium bien placés → 16 points</li></ul>
      <p>Les points de chaque catégorie se cumulent et donnent le score de la course.</p>`)}
    ${art(4, 'Séparation de la saison en blocs', `<p>${period}</p><ul>${blocks}</ul>
      <p>Le classement général ne tient pas compte des blocs : c'est le cumul des points de toutes les courses.</p>`)}
    ${art(5, 'Jokers', jokers)}
    ${art(6, 'Envoi des pronostics', `<p>Pour garantir le fair-play, personne ne doit pouvoir copier les pronostics d'un autre avant d'envoyer les siens. Les pronostics s'envoient la veille de la course ou le jour même, jusqu'à une heure avant le début des essais. L'heure limite est précisée pour chaque course.</p>
      <p class="app-note">Dans l'application : chaque pronostic reste secret jusqu'à l'heure limite fixée par l'organisateur. Ensuite, les pronostics sont verrouillés et visibles par tous.</p>`)}
    ${art(7, 'Système de récompenses / gages', `<p>À l'issue de chaque bloc, les participants ont jusqu'au début du bloc suivant pour organiser une soirée dans un bar :</p>
      <ul><li>Le 1er se fait payer deux verres par le 7e et reçoit le porte-clé de vainqueur du bloc</li><li>Le 2e se fait payer deux verres par le 6e</li><li>Le 3e se fait payer un verre par le 5e</li>
      <li>Le 4e ne se fait rien payer et ne paye rien à personne</li><li>Le 5e paye un verre au 3e</li><li>Le 6e paye deux verres au 2e</li><li>Le 7e paye deux verres au 1er et une planche commune pour grignoter</li></ul>
      <p>Il est conseillé de ne payer que des verres de 25 ou 33 cL afin de ne pas prendre le volant en état d'ébriété. Un absent à la soirée doit quand même payer (ou se faire payer) ses verres plus tard : impossible de se soustraire à une récompense ou à un gage.</p>
      <p>En fin de saison, au classement général :</p>
      <ul><li>Le 1er : tee-shirt floqué + porte-clé vainqueur de la saison + 2 bières Pleine Lune</li><li>Le 2e : porte-clé 2e de la saison + une bière Pleine Lune</li><li>Le 3e : porte-clé 3e de la saison</li></ul>`)}
    ${art(8, 'Critères de départage', `<p><b>Dans un bloc</b> : le plus de points lors de la dernière course du bloc, puis en remontant les courses de la plus récente à la plus ancienne. Ensuite, même principe avec le nombre de pilotes pronostiqués effectivement sur le podium. Sinon : shi-fu-mi en une manche gagnante (puits interdit).</p>
      <p><b>Bloc 2</b> (une seule course) : nombre de pilotes pronostiqués sur le podium, puis points marqués dans les catégories Juniors hommes et Juniors femmes. Sinon : shi-fu-mi en une manche gagnante (puits interdit).</p>
      <p><b>Classement général</b> : le plus de points lors du championnat du monde à Brisbane, puis lors de la dernière manche de coupe du monde, et ainsi de suite en remontant jusqu'à la première. Sinon : shi-fu-mi en 3 manches gagnantes (puits interdit).</p>`)}
    ${art(9, 'Mot de la fin', `<p>Pour ceux qui sont arrivés jusqu'ici en lisant tout, respect à vous, je vous love les Riders Potter &lt;3</p>`)}
  </div>`;
}

function viewAdmin() {
  if (!S.me.admin) return viewRaces();
  const s = S.settings;
  const toggle = (key, on, title, text) => `<div class="pos-row" style="justify-content:space-between;gap:16px;margin-bottom:14px">
    <div><b>${title}</b> <span class="tag ${on ? 'open' : 'done'}">${on ? 'Activé' : 'Désactivé'}</span><div class="muted small">${text}</div></div>
    <button class="btn ghost" data-action="toggle" data-key="${key}" data-value="${!on}">${on ? 'Désactiver' : 'Activer'}</button></div>`;
  const players = S.players
    .map(
      (p) => `<tr><td class="l name">${esc(p.name)} ${p.admin ? '<span class="tag joker">Organisateur</span>' : ''}</td>
      <td style="text-align:right"><button class="btn ghost" data-action="reset-password" data-user="${p.id}">Nouveau mot de passe</button>
      ${p.id === S.me.id ? '' : `<button class="btn ghost danger" data-action="delete-user" data-user="${p.id}">Supprimer</button>`}</td></tr>`
    )
    .join('');
  const season = S.season;
  const field = (label, html, width) => `<div style="flex:1 1 ${width}px;max-width:${width * 2}px"><label>${label}</label>${html}</div>`;
  const raceFields = (r) => `
    ${r.type === 'wc' ? field('Manche', `<input name="round" type="number" min="1" max="99" required value="${r.round ?? ''}">`, 70) : ''}
    ${field('Ville', `<input name="city" maxlength="40" required value="${esc(r.city || '')}">`, 150)}
    ${field('Pays', `<input name="country" maxlength="3" required placeholder="FRA" value="${esc(r.country || '')}">`, 70)}
    ${field('Date', `<input name="date" type="date" required value="${esc(r.date || '')}">`, 150)}
    ${field('Bloc', `<input name="block" type="number" min="1" max="20" required value="${r.block ?? ''}">`, 70)}`;
  const calendar = S.races
    .map(
      (r) => `<form class="row-form" data-form="race-edit" data-race="${r.id}">${plate(r)}${raceFields(r)}
      <div class="row-actions"><button class="btn ghost">Enregistrer</button><button type="button" class="btn ghost danger" data-action="race-delete" data-race="${r.id}">Supprimer</button></div></form>`
    )
    .join('');
  const nextRound = Math.max(0, ...S.races.filter((r) => r.type === 'wc').map((r) => r.round)) + 1;
  return `<div class="page-head"><h1>Organisateur</h1></div>
    <div class="panel admin"><h2>Saisons</h2>
      <div class="chips" style="margin-bottom:14px">${S.seasons.map((x) => `<span class="chip ${x.current ? 'ok' : ''}">${esc(x.name)}${x.current ? ' · en cours' : ''}</span>`).join('')}</div>
      <form class="row-form" data-form="season-new">${field('Nouvelle saison', '<input name="name" maxlength="20" required placeholder="2027">', 150)}
      <div class="row-actions"><button class="btn ghost">Créer la saison</button></div></form>
      <p class="muted small" style="margin:10px 0 0">La nouvelle saison reprend le calendrier de la saison en cours avec les dates décalées d'un an : il reste à le corriger, puis à la passer « en cours ». Les comptes des joueurs sont conservés d'une saison à l'autre.</p>
    </div>
    <div class="panel admin"><h2>Saison ${esc(season.name)} ${season.current ? '<span class="tag open">En cours</span>' : '<span class="tag done">Pas en cours</span>'}</h2>
      ${S.seasons.length > 1 ? '<p class="muted small">Pour gérer une autre saison, choisis-la dans le menu en haut de page.</p>' : ''}
      ${toggle('jokers', season.jokers, 'Jokers (article 5)', 'Permet de doubler ses points dans une catégorie à chaque manche de coupe du monde. Désactivé : les classements de cette saison sont calculés sans aucun doublement.')}
      ${season.current ? '' : `<div class="actions" style="margin:0 0 18px"><button class="btn" data-action="season-current">Passer cette saison en cours</button><button class="btn ghost danger" data-action="season-delete">Supprimer la saison</button></div>`}
      <h3 style="margin:8px 0 10px">Calendrier (${S.races.length} course${S.races.length > 1 ? 's' : ''})</h3>
      ${calendar || '<p class="muted">Aucune course.</p>'}
      <h3 style="margin:20px 0 10px">Ajouter une course</h3>
      <form class="row-form" data-form="race-new">
        ${field('Type', '<select name="type"><option value="wc">Coupe du monde</option><option value="worlds">Championnat du monde</option></select>', 190)}
        ${raceFields({ type: 'wc', round: nextRound })}
        <div class="row-actions"><button class="btn ghost">Ajouter</button></div></form>
      <p class="muted small" style="margin:10px 0 0">Le numéro de manche est ignoré pour un championnat du monde. L'heure limite et les podiums officiels se saisissent sur la page de chaque <a href="#/courses">course</a>.</p>
    </div>
    <div class="panel admin"><h2>Joueurs (${S.players.length})</h2>
      ${toggle('registration', s.registration, 'Inscriptions', 'Autorise la création de nouveaux comptes. À fermer une fois que tous les joueurs sont inscrits.')}
      <div class="table-wrap"><table><tbody>${players}</tbody></table></div></div>`;
}

function viewAccount() {
  return `<div class="page-head"><h1>Mon compte</h1><span class="muted">${esc(S.me.name)}</span></div>
    <form class="panel" data-form="password" style="max-width:460px"><h2>Changer mon mot de passe</h2>
      <div class="field"><label for="f-cur">Mot de passe actuel</label><input id="f-cur" name="current" type="password" required autocomplete="current-password"></div>
      <div class="field"><label for="f-new">Nouveau mot de passe (8 caractères minimum)</label><input id="f-new" name="password" type="password" minlength="8" maxlength="100" required autocomplete="new-password"></div>
      <div class="field"><label for="f-conf">Confirmer le nouveau mot de passe</label><input id="f-conf" name="confirm" type="password" minlength="8" maxlength="100" required autocomplete="new-password"></div>
      <p class="muted small">Tes autres appareils seront déconnectés.</p>
      <div class="actions"><button class="btn">Changer le mot de passe</button></div></form>`;
}

// ---------- Rendu et navigation ----------
function render() {
  if (!S) {
    app.innerHTML = viewAuth();
    return;
  }
  const [, page = 'courses', arg] = location.hash.split('/');
  const views = { courses: viewRaces, course: () => viewRace(arg), classement: () => viewStandings(arg || 'general'), reglement: viewRules, admin: viewAdmin, compte: viewAccount };
  const seasonSelect = S.seasons.length > 1
    ? `<select data-season aria-label="Saison affichée" style="width:auto;padding:4px 8px">${S.seasons.map((x) => `<option value="${x.id}" ${x.id === S.season.id ? 'selected' : ''}>Saison ${esc(x.name)}${x.current ? ' (en cours)' : ''}</option>`).join('')}</select>`
    : '';
  const link = (href, label, key) => `<a href="${href}" class="${page === key || (key === 'courses' && page === 'course') ? 'on' : ''}">${label}</a>`;
  app.innerHTML = `<header class="topbar"><div class="topbar-in">
      <a class="logo" href="#/courses">BMX World<b>Pronos ${esc(S.season.name)}</b></a>
      <nav>${link('#/courses', 'Courses', 'courses')}${link('#/classement/general', 'Classement', 'classement')}${link('#/reglement', 'Règlement', 'reglement')}${S.me.admin ? link('#/admin', 'Organisateur', 'admin') : ''}</nav>
      <div class="who">${seasonSelect}<a href="#/compte" title="Mon compte">${esc(S.me.name)}</a> <button class="btn ghost" data-action="logout">Déconnexion</button></div>
    </div></header><main>${(views[page] || viewRaces)()}</main>`;
}
window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  refresh();
});

// ---------- Événements ----------
app.addEventListener('change', (event) => {
  if (!event.target.matches('[data-season]')) return;
  seasonId = event.target.value;
  if (location.hash.startsWith('#/course/')) location.hash = '#/courses'; // déclenche le rechargement
  else refresh();
});
app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const race = S && S.races.find((r) => r.id === form.dataset.race);
  switch (form.dataset.form) {
    case 'auth':
      return act('POST', authMode === 'login' ? '/api/login' : '/api/register', { name: form.elements.name.value, password: form.elements.password.value });
    case 'prono':
      return act('PUT', `/api/pronos/${race.id}`, { picks: readPodiums(form, race, 'p'), joker: form.elements.joker ? form.elements.joker.value : null }, 'Pronostic enregistré !');
    case 'deadline':
      return act('PUT', `${seasonApi()}/races/${race.id}`, { deadline: form.elements.deadline.value ? new Date(form.elements.deadline.value).toISOString() : null }, 'Heure limite enregistrée.');
    case 'results':
      return act('PUT', `${seasonApi()}/races/${race.id}`, { results: readPodiums(form, race, 'r') }, 'Résultats enregistrés.');
    case 'password':
      if (form.elements.password.value !== form.elements.confirm.value) return toast('Les deux nouveaux mots de passe sont différents.', true);
      return act('PUT', '/api/password', { current: form.elements.current.value, password: form.elements.password.value }, 'Mot de passe modifié.');
    case 'season-new':
      try {
        seasonId = (await call('POST', '/api/admin/seasons', { name: form.elements.name.value })).id;
        toast('Saison créée : vérifie son calendrier ci-dessous.');
      } catch (err) {
        toast(err.message, true);
      }
      return refresh();
    case 'race-new':
    case 'race-edit': {
      const e = form.elements;
      const info = { city: e.city.value, country: e.country.value, date: e.date.value, block: e.block.value };
      if (e.round) info.round = e.round.value;
      if (form.dataset.form === 'race-edit') return act('PUT', `${seasonApi()}/races/${form.dataset.race}`, info, 'Course enregistrée.');
      return act('POST', `${seasonApi()}/races`, { ...info, type: e.type.value }, 'Course ajoutée.');
    }
  }
});
app.addEventListener('click', async (event) => {
  const authTab = event.target.closest('[data-auth]');
  if (authTab) {
    event.preventDefault();
    authMode = authTab.dataset.auth;
    return render();
  }
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'logout':
      return act('POST', '/api/logout', {});
    case 'toggle':
      return act('PUT', d.key === 'jokers' ? seasonApi() : '/api/admin/settings', { [d.key]: d.value === 'true' }, 'Réglage enregistré.');
    case 'clear-results':
      if (confirm('Effacer les résultats de cette course ?')) return act('PUT', `${seasonApi()}/races/${d.race}`, { results: {} }, 'Résultats effacés.');
      return;
    case 'season-current':
      if (confirm(`Faire de « ${S.season.name} » la saison en cours ? Les pronostics des autres saisons seront verrouillés.`)) return act('PUT', seasonApi(), { current: true }, 'Saison en cours modifiée.');
      return;
    case 'season-delete': {
      if (!confirm(`Supprimer la saison « ${S.season.name} », ses résultats et tous ses pronostics ? Cette action est définitive.`)) return;
      const url = seasonApi();
      seasonId = null;
      return act('DELETE', url, {}, 'Saison supprimée.');
    }
    case 'race-delete':
      if (confirm('Supprimer cette course, ses résultats et ses pronostics ? Cette action est définitive.')) return act('DELETE', `${seasonApi()}/races/${d.race}`, {}, 'Course supprimée.');
      return;
    case 'reset-password': {
      const password = prompt(`Nouveau mot de passe pour ${playerName(d.user)} (8 caractères minimum) :`);
      if (password) return act('PUT', `/api/admin/users/${d.user}`, { password }, 'Mot de passe modifié.');
      return;
    }
    case 'delete-user':
      if (confirm(`Supprimer ${playerName(d.user)} et tous ses pronostics ? Cette action est définitive.`)) return act('DELETE', `/api/admin/users/${d.user}`, {}, 'Joueur supprimé.');
  }
});

refresh();
