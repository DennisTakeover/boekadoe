// Rating (Elo) en het indelingsalgoritme voor De Cage.

const BASE_RATING = 1000;
const K = 32;

/** Start-rating op basis van zelfinschatting (1-10): niveau 5 = 1000. */
function startRating(level) {
  return BASE_RATING + (Number(level || 5) - 5) * 50;
}

/**
 * Berekent de Elo-rating van alle spelers opnieuw uit alle gespeelde wedstrijden.
 * Zo kloppen de ratings altijd, ook als iemand een score achteraf aanpast.
 * @param users   [{id, level}]
 * @param matches [{a1,a2,b1,b2,score_a,score_b}] in chronologische volgorde
 * @returns Map<userId, {rating, played, won, lost, drawn}>
 */
function computeRatings(users, matches) {
  const stats = new Map();
  for (const u of users) {
    stats.set(u.id, { rating: startRating(u.level), played: 0, won: 0, lost: 0, drawn: 0 });
  }
  const get = (id) => {
    if (!stats.has(id)) stats.set(id, { rating: BASE_RATING, played: 0, won: 0, lost: 0, drawn: 0 });
    return stats.get(id);
  };

  for (const m of matches) {
    if (m.score_a == null || m.score_b == null) continue;
    const A = [get(m.a1), get(m.a2)];
    const B = [get(m.b1), get(m.b2)];
    const ra = (A[0].rating + A[1].rating) / 2;
    const rb = (B[0].rating + B[1].rating) / 2;
    const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
    const actualA = m.score_a > m.score_b ? 1 : m.score_a < m.score_b ? 0 : 0.5;
    // Grotere winstmarge telt iets zwaarder (max x1.5).
    const margin = Math.abs(m.score_a - m.score_b);
    const mult = 1 + Math.min(margin, 6) / 12;
    const delta = K * mult * (actualA - expectedA);

    for (const p of A) {
      p.rating += delta;
      p.played++;
      if (actualA === 1) p.won++; else if (actualA === 0) p.lost++; else p.drawn++;
    }
    for (const p of B) {
      p.rating -= delta;
      p.played++;
      if (actualA === 0) p.won++; else if (actualA === 1) p.lost++; else p.drawn++;
    }
  }
  return stats;
}

const pairKey = (x, y) => (x < y ? `${x}-${y}` : `${y}-${x}`);

/**
 * Maakt één nieuwe ronde voor een speeldag.
 *
 * Regels:
 *  1. Wie deze dag het minst gespeeld heeft, speelt eerst (eerlijke rust-rotatie).
 *  2. Spelers worden per baan gegroepeerd op vergelijkbaar niveau (met wat
 *     willekeur zodat je niet steeds tegen dezelfde mensen speelt).
 *  3. Binnen een baan kiezen we van de 3 mogelijke team-indelingen de meest
 *     gelijkwaardige, met een straf voor partners die al eerder samen speelden.
 *
 * @param players       [{id, rating}] aanwezigen
 * @param courts        aantal beschikbare banen
 * @param history       eerdere wedstrijden [{a1,a2,b1,b2}] (deze dag + recent)
 * @param playedToday   Map<userId, aantal wedstrijden vandaag>
 * @param rng           random functie (injecteerbaar voor tests)
 * @returns { matches: [{court, a:[id,id], b:[id,id]}], resting: [id] }
 */
function generateRound(players, courts, history = [], playedToday = new Map(), rng = Math.random) {
  const numCourts = Math.min(courts, Math.floor(players.length / 4));
  if (numCourts < 1) return { matches: [], resting: players.map((p) => p.id) };

  const partnerCount = new Map();
  const opponentCount = new Map();
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const m of history) {
    bump(partnerCount, pairKey(m.a1, m.a2));
    bump(partnerCount, pairKey(m.b1, m.b2));
    for (const a of [m.a1, m.a2]) for (const b of [m.b1, m.b2]) bump(opponentCount, pairKey(a, b));
  }

  // 1. Selecteer wie er speelt: minst gespeeld eerst, gelijkspel willekeurig.
  const shuffled = players.map((p) => ({ ...p, r: rng() }));
  shuffled.sort((x, y) => (playedToday.get(x.id) || 0) - (playedToday.get(y.id) || 0) || x.r - y.r);
  const playing = shuffled.slice(0, numCourts * 4);
  const resting = shuffled.slice(numCourts * 4).map((p) => p.id);

  // 2. Groepeer op niveau, met ruis (±75 punten) voor variatie.
  playing.sort((x, y) => (y.rating + (y.r - 0.5) * 150) - (x.rating + (x.r - 0.5) * 150));
  const groups = [];
  for (let i = 0; i < numCourts; i++) groups.push(playing.slice(i * 4, i * 4 + 4));

  // 3. Beste teamverdeling per groep.
  const matches = groups.map((g, i) => {
    const [p, q, r, s] = g;
    const options = [
      [[p, q], [r, s]],
      [[p, r], [q, s]],
      [[p, s], [q, r]],
    ];
    let best = null;
    for (const [ta, tb] of options) {
      const diff = Math.abs(ta[0].rating + ta[1].rating - tb[0].rating - tb[1].rating) / 2;
      const repeatPartners =
        (partnerCount.get(pairKey(ta[0].id, ta[1].id)) || 0) +
        (partnerCount.get(pairKey(tb[0].id, tb[1].id)) || 0);
      let repeatOpp = 0;
      for (const a of ta) for (const b of tb) repeatOpp += opponentCount.get(pairKey(a.id, b.id)) || 0;
      const cost = diff + repeatPartners * 60 + repeatOpp * 10;
      if (!best || cost < best.cost) best = { cost, ta, tb };
    }
    return { court: i + 1, a: best.ta.map((x) => x.id), b: best.tb.map((x) => x.id) };
  });

  return { matches, resting };
}

module.exports = { computeRatings, generateRound, startRating, BASE_RATING };
