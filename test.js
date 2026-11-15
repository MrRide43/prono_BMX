'use strict';
// Vérifie le calcul des points (articles 3, 5 et 8). Lancer avec : node test.js
const assert = require('assert');
const R = require('./rules');

const podium = ['A', 'B', 'C'];
// Article 3 : les 9 cas de figure
const cases = [
  [['X', 'Y', 'Z'], 0],
  [['X', 'A', 'Z'], 2],
  [['A', 'Y', 'Z'], 4],
  [['B', 'A', 'Z'], 5],
  [['A', 'C', 'Z'], 7],
  [['A', 'B', 'Z'], 9],
  [['B', 'C', 'A'], 10],
  [['A', 'C', 'B'], 12],
  [['A', 'B', 'C'], 16],
];
for (const [pick, pts] of cases) assert.strictEqual(R.scoreCategory(pick, podium).points, pts, pick.join());
assert.strictEqual(R.scoreCategory(['  é a', 'b', 'c'], ['E A', 'B', 'C']).points, 16, 'accents et casse ignorés');

// Article 5 : joker = points doublés (7 -> 14), jamais au championnat du monde
const races = R.calendar2026();
const byId = Object.fromEntries(races.map((r) => [r.id, r]));
const results = { EM: podium, EW: podium };
const prono = { picks: { EM: ['A', 'C', 'Z'], EW: ['A', 'B', 'C'] }, joker: 'EM' };
assert.strictEqual(R.scoreRace({ ...byId.cdm1, results }, prono, true).points, 14 + 16);
assert.strictEqual(R.scoreRace({ ...byId.cdm1, results }, prono, false).points, 7 + 16);
assert.strictEqual(R.scoreRace({ ...byId.worlds, results }, prono, true).points, 7 + 16);

// Article 5 : 2 par catégorie + 1 supplémentaire par sexe
assert.ok(R.jokerAllowed({ EM: 2, UM: 2, EW: 0, UW: 0 }, 'EM'));
assert.ok(!R.jokerAllowed({ EM: 3, UM: 2, EW: 0, UW: 0 }, 'UM'));
assert.ok(!R.jokerAllowed({ EM: 3, UM: 0, EW: 0, UW: 0 }, 'EM'));
assert.ok(R.jokerAllowed({ EM: 3, UM: 2, EW: 2, UW: 2 }, 'UW'));

// Article 4 : blocs déduits du calendrier
assert.deepStrictEqual(R.blocksOf(races).map((b) => b.races.length), [4, 1, 4, 2]);

// Article 8 : départage dans un bloc par la dernière course
const users = [{ id: 'u1', name: 'Un' }, { id: 'u2', name: 'Deux' }, { id: 'u3', name: 'Trois' }];
byId.cdm1.results = { EM: podium };
byId.cdm2.results = { EM: podium };
const pronos = {
  cdm1: { u1: { picks: { EM: ['A', 'B', 'C'] } }, u2: { picks: { EM: ['X', 'Y', 'Z'] } }, u3: { picks: { EM: ['A', 'B', 'C'] } } },
  cdm2: { u1: { picks: { EM: ['X', 'Y', 'Z'] } }, u2: { picks: { EM: ['A', 'B', 'C'] } }, u3: { picks: { EM: ['X', 'Y', 'Z'] } } },
};
const st = R.computeStandings(users, races, pronos, true);
assert.deepStrictEqual(st.blocks[1].rows.map((r) => [r.userId, r.rank, Boolean(r.tie)]), [['u2', 1, false], ['u3', 2, true], ['u1', 2, true]]);
assert.strictEqual(st.blocks[2].started, false);

console.log('Tous les tests passent.');
