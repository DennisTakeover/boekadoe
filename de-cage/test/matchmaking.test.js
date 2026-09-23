const test = require('node:test');
const assert = require('node:assert');
const { computeRatings, generateRound } = require('../matchmaking');

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, rating: 1000 + i * 20 }));

test('elke speler zit maximaal één keer in een ronde', () => {
  const { matches, resting } = generateRound(players(22), 5);
  assert.equal(matches.length, 5);
  const ids = matches.flatMap((m) => [...m.a, ...m.b]);
  assert.equal(new Set(ids).size, 20);
  assert.equal(resting.length, 2);
});

test('niet meer wedstrijden dan banen of spelers toelaten', () => {
  assert.equal(generateRound(players(25), 3).matches.length, 3);
  assert.equal(generateRound(players(7), 3).matches.length, 1);
  assert.equal(generateRound(players(3), 3).matches.length, 0);
});

test('rust wordt eerlijk verdeeld', () => {
  const ps = players(10);
  const played = new Map();
  const history = [];
  for (let r = 0; r < 5; r++) {
    const { matches } = generateRound(ps, 2, history, played);
    for (const m of matches) {
      history.push({ a1: m.a[0], a2: m.a[1], b1: m.b[0], b2: m.b[1] });
      for (const id of [...m.a, ...m.b]) played.set(id, (played.get(id) || 0) + 1);
    }
  }
  const counts = ps.map((p) => played.get(p.id) || 0);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `ongelijke verdeling: ${counts}`);
});

test('teams binnen een baan zijn gebalanceerd', () => {
  const ps = [{ id: 1, rating: 1400 }, { id: 2, rating: 1300 }, { id: 3, rating: 900 }, { id: 4, rating: 800 }];
  const { matches } = generateRound(ps, 1);
  const team = matches[0].a.slice().sort();
  // sterkste + zwakste tegen de middelste twee
  assert.ok(JSON.stringify(team) === '[1,4]' || JSON.stringify(team) === '[2,3]');
});

test('elo: winnaars stijgen, verliezers dalen', () => {
  const users = [1, 2, 3, 4].map((id) => ({ id, level: 5 }));
  const r = computeRatings(users, [{ a1: 1, a2: 2, b1: 3, b2: 4, score_a: 6, score_b: 3 }]);
  assert.ok(r.get(1).rating > 1000);
  assert.ok(r.get(3).rating < 1000);
  assert.equal(r.get(1).won, 1);
  assert.equal(r.get(4).lost, 1);
});
