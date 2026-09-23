const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('./db');
const { computeRatings, generateRound } = require('./matchmaking');

const SECURE_COOKIE = process.env.SECURE_COOKIE === '1' || !!process.env.VERCEL;
const CSS = fs.readFileSync(path.join(__dirname, 'public', 'style.css'));

// ---------------------------------------------------------------- helpers

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  // Op Vercel is de body al geparsed; lokaal lezen we de stream zelf.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    return Promise.resolve(Object.fromEntries(new URLSearchParams(String(req.body))));
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error('Body te groot'));
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

// Datum in Nederlandse tijd, ook als de server (Vercel) in UTC draait.
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });

function fmtDate(d, withYear = false) {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}),
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const levelOptions = (sel) =>
  Array.from({ length: 10 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === Number(sel) ? 'selected' : ''}>${n}${n === 1 ? ' – beginner' : n === 10 ? ' – top' : ''}</option>`)
    .join('');
const sideOptions = (sel) =>
  ['beide', 'links', 'rechts'].map((s) => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('');
const stars = (n) => (n ? '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)) : '');

// ---------------------------------------------------------------- app

function createApp(db) {
  async function currentUser(req) {
    const token = parseCookies(req).cage_session;
    if (!token) return null;
    return (await db.get(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token)) || null;
  }

  async function allRatings() {
    const users = await db.all('SELECT id, level FROM users');
    const matches = await db.all(`
      SELECT m.* FROM matches m JOIN play_days d ON d.id = m.day_id
      WHERE m.score_a IS NOT NULL
      ORDER BY d.date, d.time, m.round, m.court`);
    return computeRatings(users, matches);
  }

  const userNames = async () => new Map((await db.all('SELECT id, name FROM users')).map((u) => [u.id, u.name]));

  // ------------------------------------------------------------ layout

  function layout(res, user, title, body, status = 200) {
    const nav = user
      ? `<nav>
          <a href="/">Speeldagen</a>
          <a href="/ranking">Ranking</a>
          <a href="/profiel">Profiel</a>
          ${user.is_admin ? '<a href="/admin">Admin</a>' : ''}
          <form method="post" action="/logout" class="inline"><button class="link">Uitloggen</button></form>
        </nav>`
      : '';
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · De Cage</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <a href="/" class="logo">DE <span>CAGE</span></a>
    ${nav}
  </header>
  <main>${body}</main>
</body>
</html>`);
  }

  const redirect = (res, to, cookie) => {
    const headers = { Location: to };
    if (cookie) headers['Set-Cookie'] = cookie;
    res.writeHead(303, headers);
    res.end();
  };

  const notFound = (res, user) => layout(res, user, 'Niet gevonden', '<h1>Niet gevonden</h1><p><a href="/">Terug</a></p>', 404);

  async function startSession(res, userId, to = '/') {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO auth_sessions (token, user_id) VALUES (?, ?)', token, userId);
    const cookie = `cage_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}${SECURE_COOKIE ? '; Secure' : ''}`;
    redirect(res, to, cookie);
  }

  // ------------------------------------------------------------ views

  function authPage(res, mode, error = '', values = {}) {
    const isReg = mode === 'register';
    layout(res, null, isReg ? 'Account maken' : 'Inloggen', `
      <div class="card narrow">
        <h1>${isReg ? 'Account maken' : 'Inloggen'}</h1>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <form method="post" action="/${isReg ? 'register' : 'login'}" class="stack">
          ${isReg ? `<label>Naam<input name="name" required maxlength="40" value="${esc(values.name)}"></label>` : ''}
          <label>E-mail<input name="email" type="email" required value="${esc(values.email)}"></label>
          <label>Wachtwoord<input name="password" type="password" required minlength="${isReg ? 6 : 1}"></label>
          ${isReg ? `
          <label>Niveau (zelfinschatting)
            <select name="level">${levelOptions(5)}</select>
          </label>
          <label>Voorkeurskant<select name="side">${sideOptions('beide')}</select></label>` : ''}
          <button>${isReg ? 'Account maken' : 'Inloggen'}</button>
        </form>
        <p class="muted">${isReg
          ? 'Heb je al een account? <a href="/login">Inloggen</a>'
          : 'Nog geen account? <a href="/register">Account maken</a>'}</p>
      </div>`);
  }

  async function home(res, user) {
    const days = await db.all(`
      SELECT d.*, (SELECT COUNT(*) FROM attendance a WHERE a.day_id = d.id) AS n,
             EXISTS(SELECT 1 FROM attendance a WHERE a.day_id = d.id AND a.user_id = ?) AS joined
      FROM play_days d WHERE d.date >= ? ORDER BY d.date, d.time`, user.id, today());
    const past = await db.all(`SELECT * FROM play_days WHERE date < ? ORDER BY date DESC, time DESC LIMIT 12`, today());
    const todo = await db.all(`
      SELECT m.*, d.date FROM matches m JOIN play_days d ON d.id = m.day_id
      WHERE ? IN (m.a1, m.a2, m.b1, m.b2) AND d.date <= ?
        AND (m.score_a IS NULL OR NOT EXISTS (SELECT 1 FROM match_ratings r WHERE r.match_id = m.id AND r.user_id = ?))
      ORDER BY d.date DESC, m.round LIMIT 10`, user.id, today(), user.id);
    const names = await userNames();

    layout(res, user, 'Speeldagen', `
      <h1>Hoi ${esc(user.name)} 👋</h1>
      ${todo.length ? `
        <section class="card highlight">
          <h2>Nog in te vullen</h2>
          <ul class="plain">${todo.map((m) => `
            <li><a href="/dag/${m.day_id}#m${m.id}">${fmtDate(m.date)} · ronde ${m.round}</a>
              <span class="muted">${esc(names.get(m.a1))} & ${esc(names.get(m.a2))} vs ${esc(names.get(m.b1))} & ${esc(names.get(m.b2))}
              — ${m.score_a == null ? 'score ontbreekt' : 'nog niet beoordeeld'}</span></li>`).join('')}
          </ul>
        </section>` : ''}
      <h2>Komende speeldagen</h2>
      ${days.length ? days.map((d) => `
        <div class="card day">
          <div>
            <a href="/dag/${d.id}" class="day-title">${fmtDate(d.date)} · ${esc(d.time)}</a>
            <div class="muted">${d.n} aangemeld · ${d.courts} banen${d.note ? ` · ${esc(d.note)}` : ''}</div>
          </div>
          <form method="post" action="/dag/${d.id}/${d.joined ? 'afmelden' : 'aanmelden'}">
            <button class="${d.joined ? 'secondary' : ''}">${d.joined ? '✓ Ik doe mee' : 'Ik doe mee'}</button>
          </form>
        </div>`).join('') : `<p class="muted">Nog geen speeldagen gepland${user.is_admin ? ' — maak er een aan via <a href="/admin">Admin</a>' : ''}.</p>`}
      ${past.length ? `
        <h2>Eerdere speeldagen</h2>
        <ul class="plain">${past.map((d) => `<li><a href="/dag/${d.id}">${fmtDate(d.date, true)} · ${esc(d.time)}</a></li>`).join('')}</ul>` : ''}
    `);
  }

  async function dayPage(res, user, dayId) {
    const day = await db.get('SELECT * FROM play_days WHERE id = ?', dayId);
    if (!day) return notFound(res, user);
    const [names, ratings, attendees, matches, ratingRows, allUsers] = await Promise.all([
      userNames(),
      allRatings(),
      db.all(`SELECT u.id, u.name FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.day_id = ? ORDER BY u.name`, dayId),
      db.all('SELECT * FROM matches WHERE day_id = ? ORDER BY round, court', dayId),
      db.all(`SELECT r.* FROM match_ratings r JOIN matches m ON m.id = r.match_id WHERE m.day_id = ?`, dayId),
      user.is_admin ? db.all('SELECT id, name FROM users ORDER BY name') : [],
    ]);
    const attendingIds = new Set(attendees.map((a) => a.id));
    const joined = attendingIds.has(user.id);

    const rounds = new Map();
    for (const m of matches) {
      if (!rounds.has(m.round)) rounds.set(m.round, []);
      rounds.get(m.round).push(m);
    }

    const n = (id) => `<a href="/speler/${id}">${esc(names.get(id) ?? '?')}</a>`;

    const matchCard = (m) => {
      const mine = [m.a1, m.a2, m.b1, m.b2].includes(user.id);
      const rs = ratingRows.filter((r) => r.match_id === m.id);
      const avg = rs.length ? rs.reduce((s, r) => s + r.stars, 0) / rs.length : 0;
      const myRating = rs.find((r) => r.user_id === user.id);
      const hasScore = m.score_a != null;
      const winA = hasScore && m.score_a > m.score_b;
      const winB = hasScore && m.score_b > m.score_a;
      return `
        <div class="match ${mine ? 'mine' : ''}" id="m${m.id}">
          <div class="court">Baan ${m.court}</div>
          <div class="teams">
            <div class="team ${winA ? 'win' : ''}">${n(m.a1)} & ${n(m.a2)}</div>
            <div class="score">${hasScore ? `${m.score_a} – ${m.score_b}` : 'vs'}</div>
            <div class="team ${winB ? 'win' : ''}">${n(m.b1)} & ${n(m.b2)}</div>
          </div>
          <details ${!hasScore && mine ? 'open' : ''}>
            <summary>${hasScore ? `Score aanpassen <span class="muted">(ingevuld door ${esc(names.get(m.score_by) ?? '?')})</span>` : 'Score invullen'}</summary>
            <form method="post" action="/wedstrijd/${m.id}/score" class="score-form">
              <input name="score_a" type="number" min="0" max="99" required value="${m.score_a ?? ''}" aria-label="Games team 1">
              <span>–</span>
              <input name="score_b" type="number" min="0" max="99" required value="${m.score_b ?? ''}" aria-label="Games team 2">
              <button>Opslaan</button>
            </form>
          </details>
          <div class="rating">
            ${rs.length ? `<span class="stars" title="${avg.toFixed(1)} gemiddeld">${stars(avg)}</span> <span class="muted">${rs.length}×</span>` : ''}
            ${mine ? `
              <form method="post" action="/wedstrijd/${m.id}/rating" class="star-form">
                <span class="muted">${myRating ? 'Jouw beoordeling:' : 'Beoordeel deze partij:'}</span>
                ${[1, 2, 3, 4, 5].map((s) => `<button name="stars" value="${s}" class="star ${myRating && myRating.stars >= s ? 'on' : ''}" title="${s} ster${s > 1 ? 'ren' : ''}">★</button>`).join('')}
              </form>` : ''}
          </div>
        </div>`;
    };

    const perRound = Math.min(day.courts, Math.floor(attendees.length / 4));
    const adminPanel = user.is_admin ? `
      <section class="card admin">
        <h2>Admin</h2>
        <form method="post" action="/admin/dag/${day.id}/genereer" class="row">
          <label>Rondes <input name="rounds" type="number" min="1" max="10" value="1" class="small"></label>
          <button>⚡ Genereer wedstrijden</button>
        </form>
        <p class="muted">${attendees.length} aanwezig, ${day.courts} banen → ${perRound} wedstrijden per ronde, ${Math.max(0, attendees.length - perRound * 4)} rusten.</p>
        ${rounds.size ? `
          <form method="post" action="/admin/dag/${day.id}/laatste-ronde-weg" onsubmit="return confirm('Laatste ronde verwijderen?')">
            <button class="secondary">Laatste ronde verwijderen</button>
          </form>` : ''}
        <form method="post" action="/admin/dag/${day.id}/deelnemer" class="row">
          <select name="user_id">${allUsers
            .map((u) => `<option value="${u.id}">${esc(u.name)}${attendingIds.has(u.id) ? ' ✓' : ''}</option>`).join('')}</select>
          <button name="action" value="add">Toevoegen</button>
          <button name="action" value="remove" class="secondary">Verwijderen</button>
        </form>
        <form method="post" action="/admin/dag/${day.id}/bewerk" class="row">
          <input name="date" type="date" value="${esc(day.date)}" required>
          <input name="time" type="time" value="${esc(day.time)}" required>
          <label>Banen <input name="courts" type="number" min="1" max="20" value="${day.courts}" class="small"></label>
          <input name="note" placeholder="Notitie (locatie…)" value="${esc(day.note)}">
          <button class="secondary">Opslaan</button>
        </form>
      </section>` : '';

    layout(res, user, fmtDate(day.date), `
      <p><a href="/">← Speeldagen</a></p>
      <h1>${fmtDate(day.date, true)} · ${esc(day.time)}</h1>
      <p class="muted">${day.courts} banen${day.note ? ` · ${esc(day.note)}` : ''}</p>
      <form method="post" action="/dag/${day.id}/${joined ? 'afmelden' : 'aanmelden'}">
        <button class="${joined ? 'secondary' : ''}">${joined ? '✓ Ik doe mee — afmelden' : 'Ik doe mee'}</button>
      </form>

      <section>
        <h2>Aanwezig (${attendees.length})</h2>
        <div class="chips">${attendees.map((a) => `<span class="chip">${esc(a.name)} <small>${Math.round(ratings.get(a.id)?.rating ?? 1000)}</small></span>`).join('') || '<span class="muted">Nog niemand</span>'}</div>
      </section>

      ${adminPanel}

      ${[...rounds.entries()].map(([r, ms]) => {
        const playing = new Set(ms.flatMap((m) => [m.a1, m.a2, m.b1, m.b2]));
        const resting = attendees.filter((a) => !playing.has(a.id));
        return `
          <section>
            <h2>Ronde ${r}</h2>
            <div class="matches">${ms.map(matchCard).join('')}</div>
            ${resting.length ? `<p class="muted">Rust: ${resting.map((a) => esc(a.name)).join(', ')}</p>` : ''}
          </section>`;
      }).join('') || '<p class="muted">Nog geen wedstrijden ingedeeld.</p>'}
    `);
  }

  async function rankingPage(res, user) {
    const ratings = await allRatings();
    const users = await db.all('SELECT id, name, side FROM users');
    const rows = users
      .map((u) => ({ id: u.id, name: u.name, ...ratings.get(u.id) }))
      .sort((a, b) => b.rating - a.rating);
    layout(res, user, 'Ranking', `
      <h1>Ranking</h1>
      <p class="muted">Elo-rating op basis van alle ingevulde scores. Start-rating komt van je eigen niveau-inschatting.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Speler</th><th>Rating</th><th>Gespeeld</th><th>W</th><th>V</th><th>Winst%</th></tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr class="${r.id === user.id ? 'me' : ''}">
            <td>${i + 1}</td>
            <td><a href="/speler/${r.id}">${esc(r.name)}</a></td>
            <td><b>${Math.round(r.rating)}</b></td>
            <td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td>
            <td>${r.played ? Math.round((r.won / r.played) * 100) + '%' : '–'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`);
  }

  async function playerPage(res, user, id) {
    const p = await db.get('SELECT * FROM users WHERE id = ?', id);
    if (!p) return notFound(res, user);
    const s = (await allRatings()).get(p.id);
    const names = await userNames();
    const all = await db.all(`
      SELECT m.*, d.date FROM matches m JOIN play_days d ON d.id = m.day_id
      WHERE ? IN (m.a1, m.a2, m.b1, m.b2) AND m.score_a IS NOT NULL
      ORDER BY d.date DESC, m.round DESC`, p.id);
    const recent = all.slice(0, 20);
    // Beste partner: met wie win je het vaakst (min. 2 potjes samen)
    const partners = new Map();
    for (const m of all) {
      const inA = m.a1 === p.id || m.a2 === p.id;
      const mate = inA ? (m.a1 === p.id ? m.a2 : m.a1) : (m.b1 === p.id ? m.b2 : m.b1);
      const won = inA ? m.score_a > m.score_b : m.score_b > m.score_a;
      const e = partners.get(mate) || { n: 0, w: 0 };
      e.n++; if (won) e.w++;
      partners.set(mate, e);
    }
    const best = [...partners.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n)[0];

    layout(res, user, p.name, `
      <p><a href="/ranking">← Ranking</a></p>
      <h1>${esc(p.name)}</h1>
      <div class="stats">
        <div><b>${Math.round(s.rating)}</b><span>rating</span></div>
        <div><b>${s.played}</b><span>gespeeld</span></div>
        <div><b>${s.won}</b><span>gewonnen</span></div>
        <div><b>${s.played ? Math.round((s.won / s.played) * 100) : 0}%</b><span>winst</span></div>
      </div>
      <p>Speelt het liefst: <b>${esc(p.side)}</b>${best ? ` · Beste partner: <b>${esc(names.get(best[0]))}</b> (${best[1].w}/${best[1].n} gewonnen)` : ''}</p>
      ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
      <h2>Laatste wedstrijden</h2>
      <ul class="plain">${recent.map((m) => {
        const inA = m.a1 === p.id || m.a2 === p.id;
        const won = inA ? m.score_a > m.score_b : m.score_b > m.score_a;
        const draw = m.score_a === m.score_b;
        return `<li><span class="badge ${draw ? '' : won ? 'w' : 'l'}">${draw ? 'G' : won ? 'W' : 'V'}</span>
          <a href="/dag/${m.day_id}#m${m.id}">${fmtDate(m.date)}</a>
          ${esc(names.get(m.a1))} & ${esc(names.get(m.a2))} <b>${m.score_a}–${m.score_b}</b> ${esc(names.get(m.b1))} & ${esc(names.get(m.b2))}</li>`;
      }).join('') || '<li class="muted">Nog geen wedstrijden.</li>'}</ul>`);
  }

  function profilePage(res, user, msg = '') {
    layout(res, user, 'Profiel', `
      <div class="card narrow">
        <h1>Mijn profiel</h1>
        ${msg ? `<p class="ok">${esc(msg)}</p>` : ''}
        <form method="post" action="/profiel" class="stack">
          <label>Naam<input name="name" required maxlength="40" value="${esc(user.name)}"></label>
          <label>Niveau (zelfinschatting, bepaalt je start-rating)<select name="level">${levelOptions(user.level)}</select></label>
          <label>Voorkeurskant<select name="side">${sideOptions(user.side)}</select></label>
          <label>Over mij<textarea name="bio" maxlength="300" rows="3">${esc(user.bio)}</textarea></label>
          <label>Nieuw wachtwoord <span class="muted">(leeg laten = niet wijzigen)</span><input name="password" type="password" minlength="6"></label>
          <button>Opslaan</button>
        </form>
        <p><a href="/speler/${user.id}">Bekijk mijn statistieken →</a></p>
      </div>`);
  }

  async function adminPage(res, user, msg = '') {
    const days = await db.all(`
      SELECT d.*, (SELECT COUNT(*) FROM attendance a WHERE a.day_id = d.id) AS n,
             (SELECT COUNT(*) FROM matches m WHERE m.day_id = d.id) AS nm
      FROM play_days d ORDER BY d.date DESC, d.time DESC LIMIT 30`);
    const users = await db.all('SELECT * FROM users ORDER BY name');
    layout(res, user, 'Admin', `
      <h1>Admin</h1>
      ${msg ? `<p class="ok">${esc(msg)}</p>` : ''}
      <section class="card">
        <h2>Nieuwe speeldag</h2>
        <form method="post" action="/admin/dag" class="row">
          <input name="date" type="date" required value="${today()}">
          <input name="time" type="time" required value="20:00">
          <label>Banen <input name="courts" type="number" min="1" max="20" value="3" class="small"></label>
          <input name="note" placeholder="Notitie (locatie…)">
          <label class="check"><input type="checkbox" name="repeat" value="4"> 4 weken herhalen</label>
          <button>Aanmaken</button>
        </form>
      </section>

      <section class="card">
        <h2>Speeldagen</h2>
        <ul class="plain">${days.map((d) => `
          <li class="row between">
            <a href="/dag/${d.id}">${fmtDate(d.date, true)} · ${esc(d.time)}</a>
            <span class="muted">${d.n} spelers · ${d.nm} wedstrijden</span>
            <form method="post" action="/admin/dag/${d.id}/verwijder" onsubmit="return confirm('Speeldag inclusief wedstrijden verwijderen?')">
              <button class="danger small-btn">Verwijder</button>
            </form>
          </li>`).join('') || '<li class="muted">Nog geen speeldagen.</li>'}</ul>
      </section>

      <section class="card">
        <h2>Leden (${users.length})</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Naam</th><th>E-mail</th><th>Niveau</th><th>Admin</th><th>Wachtwoord resetten</th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td><a href="/speler/${u.id}">${esc(u.name)}</a></td>
              <td>${esc(u.email)}</td>
              <td>${u.level}</td>
              <td>
                <form method="post" action="/admin/lid/${u.id}/admin">
                  <button class="small-btn ${u.is_admin ? '' : 'secondary'}" ${u.id === user.id ? 'disabled' : ''}>${u.is_admin ? 'Ja' : 'Nee'}</button>
                </form>
              </td>
              <td>
                <form method="post" action="/admin/lid/${u.id}/wachtwoord" class="row">
                  <input name="password" type="text" minlength="6" placeholder="nieuw wachtwoord" required class="small-input">
                  <button class="small-btn secondary">Zet</button>
                </form>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </section>`);
  }

  // ------------------------------------------------------------ actions

  async function makeRounds(dayId, count) {
    const day = await db.get('SELECT * FROM play_days WHERE id = ?', dayId);
    const ratings = await allRatings();
    const players = (await db.all('SELECT user_id AS id FROM attendance WHERE day_id = ?', dayId))
      .map((p) => ({ id: p.id, rating: ratings.get(p.id)?.rating ?? 1000 }));
    // Geschiedenis: deze dag + de twee vorige speeldagen (om herhaling te voorkomen).
    const history = await db.all(`
      SELECT m.* FROM matches m WHERE m.day_id IN (
        SELECT id FROM play_days WHERE id = ? OR date < ? ORDER BY date DESC LIMIT 3)`, dayId, day.date);
    const playedToday = new Map();
    for (const m of history.filter((m) => m.day_id === dayId)) {
      for (const id of [m.a1, m.a2, m.b1, m.b2]) playedToday.set(id, (playedToday.get(id) || 0) + 1);
    }
    let round = (await db.get('SELECT MAX(round) AS r FROM matches WHERE day_id = ?', dayId)).r || 0;
    const inserts = [];
    for (let i = 0; i < count; i++) {
      const { matches } = generateRound(players, day.courts, history, playedToday);
      if (!matches.length) break;
      round++;
      for (const m of matches) {
        inserts.push({
          sql: 'INSERT INTO matches (day_id, round, court, a1, a2, b1, b2) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [dayId, round, m.court, m.a[0], m.a[1], m.b[0], m.b[1]],
        });
        history.push({ a1: m.a[0], a2: m.a[1], b1: m.b[0], b2: m.b[1] });
        for (const id of [...m.a, ...m.b]) playedToday.set(id, (playedToday.get(id) || 0) + 1);
      }
    }
    if (inserts.length) await db.client.batch(inserts, 'write');
    return inserts.length;
  }

  // ------------------------------------------------------------ router

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });
  const PUBLIC = { public: true };
  const ADMIN = { admin: true };
  const backTo = (req, id) => (req.headers.referer?.includes(`/dag/${id}`) ? `/dag/${id}` : '/');

  route('GET', /^\/login$/, (req, res) => authPage(res, 'login'), PUBLIC);
  route('GET', /^\/register$/, (req, res) => authPage(res, 'register'), PUBLIC);

  route('POST', /^\/register$/, async (req, res) => {
    const b = await readBody(req);
    const email = (b.email || '').trim().toLowerCase();
    const name = (b.name || '').trim();
    if (!name || !email || (b.password || '').length < 6) return authPage(res, 'register', 'Vul alles in (wachtwoord min. 6 tekens).', b);
    if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) return authPage(res, 'register', 'Dit e-mailadres heeft al een account.', b);
    const isFirst = (await db.get('SELECT COUNT(*) AS n FROM users')).n === 0;
    const adminEmails = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim());
    const level = Math.min(10, Math.max(1, Number(b.level) || 5));
    const side = ['links', 'rechts', 'beide'].includes(b.side) ? b.side : 'beide';
    const { lastInsertRowid } = await db.run(
      'INSERT INTO users (name, email, password_hash, is_admin, level, side) VALUES (?, ?, ?, ?, ?, ?)',
      name, email, hashPassword(b.password), isFirst || adminEmails.includes(email) ? 1 : 0, level, side);
    await startSession(res, lastInsertRowid);
  }, PUBLIC);

  route('POST', /^\/login$/, async (req, res) => {
    const b = await readBody(req);
    const u = await db.get('SELECT * FROM users WHERE email = ?', (b.email || '').trim().toLowerCase());
    if (!u || !checkPassword(b.password || '', u.password_hash)) return authPage(res, 'login', 'E-mail of wachtwoord klopt niet.', b);
    await startSession(res, u.id);
  }, PUBLIC);

  route('POST', /^\/logout$/, async (req, res) => {
    await db.run('DELETE FROM auth_sessions WHERE token = ?', parseCookies(req).cage_session || '');
    redirect(res, '/login', 'cage_session=; Path=/; Max-Age=0');
  }, PUBLIC);

  route('GET', /^\/$/, (req, res, user) => home(res, user));
  route('GET', /^\/dag\/(\d+)$/, (req, res, user, [id]) => dayPage(res, user, Number(id)));
  route('GET', /^\/ranking$/, (req, res, user) => rankingPage(res, user));
  route('GET', /^\/speler\/(\d+)$/, (req, res, user, [id]) => playerPage(res, user, Number(id)));
  route('GET', /^\/profiel$/, (req, res, user) => profilePage(res, user));

  route('POST', /^\/profiel$/, async (req, res, user) => {
    const b = await readBody(req);
    const name = (b.name || '').trim() || user.name;
    const level = Math.min(10, Math.max(1, Number(b.level) || user.level));
    const side = ['links', 'rechts', 'beide'].includes(b.side) ? b.side : user.side;
    await db.run('UPDATE users SET name = ?, level = ?, side = ?, bio = ? WHERE id = ?', name, level, side, (b.bio || '').slice(0, 300), user.id);
    if (b.password && b.password.length >= 6) await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), user.id);
    profilePage(res, await db.get('SELECT * FROM users WHERE id = ?', user.id), 'Opgeslagen!');
  });

  route('POST', /^\/dag\/(\d+)\/aanmelden$/, async (req, res, user, [id]) => {
    if (await db.get('SELECT 1 FROM play_days WHERE id = ?', id)) {
      await db.run('INSERT OR IGNORE INTO attendance (day_id, user_id) VALUES (?, ?)', id, user.id);
    }
    redirect(res, backTo(req, id));
  });
  route('POST', /^\/dag\/(\d+)\/afmelden$/, async (req, res, user, [id]) => {
    await db.run('DELETE FROM attendance WHERE day_id = ? AND user_id = ?', id, user.id);
    redirect(res, backTo(req, id));
  });

  route('POST', /^\/wedstrijd\/(\d+)\/score$/, async (req, res, user, [id]) => {
    const b = await readBody(req);
    const m = await db.get('SELECT * FROM matches WHERE id = ?', id);
    if (!m) return notFound(res, user);
    const a = Number(b.score_a), s = Number(b.score_b);
    if (Number.isInteger(a) && Number.isInteger(s) && a >= 0 && s >= 0 && a < 100 && s < 100) {
      await db.run(`UPDATE matches SET score_a = ?, score_b = ?, score_by = ?, score_at = datetime('now') WHERE id = ?`, a, s, user.id, id);
    }
    redirect(res, `/dag/${m.day_id}#m${m.id}`);
  });

  route('POST', /^\/wedstrijd\/(\d+)\/rating$/, async (req, res, user, [id]) => {
    const b = await readBody(req);
    const m = await db.get('SELECT * FROM matches WHERE id = ?', id);
    if (!m) return notFound(res, user);
    const st = Number(b.stars);
    if ([m.a1, m.a2, m.b1, m.b2].includes(user.id) && st >= 1 && st <= 5) {
      await db.run(`INSERT INTO match_ratings (match_id, user_id, stars) VALUES (?, ?, ?)
         ON CONFLICT (match_id, user_id) DO UPDATE SET stars = excluded.stars`, id, user.id, st);
    }
    redirect(res, `/dag/${m.day_id}#m${m.id}`);
  });

  // Admin
  route('GET', /^\/admin$/, (req, res, user) => adminPage(res, user), ADMIN);

  route('POST', /^\/admin\/dag$/, async (req, res) => {
    const b = await readBody(req);
    const weeks = b.repeat ? 4 : 1;
    const courts = Math.min(20, Math.max(1, Number(b.courts) || 3));
    for (let w = 0; w < weeks; w++) {
      const d = new Date(`${b.date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7 * w);
      await db.run('INSERT INTO play_days (date, time, courts, note) VALUES (?, ?, ?, ?)', d.toISOString().slice(0, 10), b.time || '20:00', courts, b.note || '');
    }
    redirect(res, '/admin');
  }, ADMIN);

  route('POST', /^\/admin\/dag\/(\d+)\/bewerk$/, async (req, res, user, [id]) => {
    const b = await readBody(req);
    await db.run('UPDATE play_days SET date = ?, time = ?, courts = ?, note = ? WHERE id = ?',
      b.date, b.time, Math.min(20, Math.max(1, Number(b.courts) || 3)), b.note || '', id);
    redirect(res, `/dag/${id}`);
  }, ADMIN);

  route('POST', /^\/admin\/dag\/(\d+)\/verwijder$/, async (req, res, user, [id]) => {
    await db.client.batch([
      { sql: 'DELETE FROM match_ratings WHERE match_id IN (SELECT id FROM matches WHERE day_id = ?)', args: [id] },
      { sql: 'DELETE FROM matches WHERE day_id = ?', args: [id] },
      { sql: 'DELETE FROM attendance WHERE day_id = ?', args: [id] },
      { sql: 'DELETE FROM play_days WHERE id = ?', args: [id] },
    ], 'write');
    redirect(res, '/admin');
  }, ADMIN);

  route('POST', /^\/admin\/dag\/(\d+)\/deelnemer$/, async (req, res, user, [id]) => {
    const b = await readBody(req);
    if (b.action === 'add') await db.run('INSERT OR IGNORE INTO attendance (day_id, user_id) VALUES (?, ?)', id, b.user_id);
    else await db.run('DELETE FROM attendance WHERE day_id = ? AND user_id = ?', id, b.user_id);
    redirect(res, `/dag/${id}`);
  }, ADMIN);

  route('POST', /^\/admin\/dag\/(\d+)\/genereer$/, async (req, res, user, [id]) => {
    const b = await readBody(req);
    if (await db.get('SELECT 1 FROM play_days WHERE id = ?', id)) {
      await makeRounds(Number(id), Math.min(10, Math.max(1, Number(b.rounds) || 1)));
    }
    redirect(res, `/dag/${id}`);
  }, ADMIN);

  route('POST', /^\/admin\/dag\/(\d+)\/laatste-ronde-weg$/, async (req, res, user, [id]) => {
    const where = 'day_id = ? AND round = (SELECT MAX(round) FROM matches WHERE day_id = ?)';
    await db.client.batch([
      { sql: `DELETE FROM match_ratings WHERE match_id IN (SELECT id FROM matches WHERE ${where})`, args: [id, id] },
      { sql: `DELETE FROM matches WHERE ${where}`, args: [id, id] },
    ], 'write');
    redirect(res, `/dag/${id}`);
  }, ADMIN);

  route('POST', /^\/admin\/lid\/(\d+)\/admin$/, async (req, res, user, [id]) => {
    if (Number(id) !== user.id) await db.run('UPDATE users SET is_admin = 1 - is_admin WHERE id = ?', id);
    redirect(res, '/admin');
  }, ADMIN);

  route('POST', /^\/admin\/lid\/(\d+)\/wachtwoord$/, async (req, res, user, [id]) => {
    const b = await readBody(req);
    if ((b.password || '').length >= 6) {
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), id);
      await db.run('DELETE FROM auth_sessions WHERE user_id = ?', id);
    }
    await adminPage(res, user, 'Wachtwoord aangepast.');
  }, ADMIN);

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/style.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
        return res.end(CSS);
      }
      await db.ready;
      const user = await currentUser(req);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = url.pathname.match(r.pattern);
        if (!match) continue;
        if (!r.public && !user) return redirect(res, '/login');
        if (r.admin && !user.is_admin) return layout(res, user, 'Geen toegang', '<h1>Alleen voor admins</h1>', 403);
        return await r.handler(req, res, user, match.slice(1));
      }
      notFound(res, user);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Er ging iets mis.');
    }
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  http.createServer(createApp(openDb())).listen(port, () => console.log(`De Cage draait op http://localhost:${port}`));
}

module.exports = { createApp };
