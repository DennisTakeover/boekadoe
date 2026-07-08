// api/rating.js
//
// Vercel serverless function — bridge between the public rating landing page
// and the "Boekadoe — Boekenbeoordeling" Airtable base.
//
// Deploy: put this file at api/rating.js in a Vercel project, then set the
// environment variable AIRTABLE_API_KEY (Airtable personal access token,
// scopes: data.records:read, data.records:write, on this base only).
//
// Endpoints:
//   GET  /api/rating?action=books&cat=6-8&month=2026-07
//        -> { books: [{ id, title, cover }] }
//   POST /api/rating   (application/json body, see RatingPayload below)
//        -> { ok: true }

const AIRTABLE_BASE_ID = 'applEy4b9Sj2icYec';

const TABLES = {
  boeken: 'tblxgESjjlYAcMwsA',
  maandpakketten: 'tblbj5elF1XY3D4w2',
  ratings: 'tblr5xzHaTjK552fe',
};

const FIELDS = {
  boeken: {
    titel: 'fldwacHCdMpaQXGg8',
    cover: 'fld1kSbd3lgm0qxBh',
    categorie: 'fldTnl42MRMfj6xcY',
  },
  maandpakketten: {
    naam: 'fldnG4itV2cclXgDs',
    boeken: 'fldy61j1fcnJPeu8c',
  },
  ratings: {
    orderId: 'fldXEzDlyUDD25CIv',
    childId: 'fldbIxwF8n1k9UkkO',
    kidName: 'fldn7YqpKGMq4yVY6',
    categorie: 'fldrSqhEY128PemVm',
    pakketType: 'fld3FxZXbfiEyXqF6',
    maand: 'fldOak6zB9sWgnZX2',
    cijfer: 'fldxQbXHuv0pJsnal',
    boekenRaak: 'fldviFSfBk38JLNw1',
    nietRaakLeeftijd: 'fldt69RhUJGPcHDX3',
    nietRaakSmaak: 'fldwkiu54UTnwlqwk',
    ingevuldOp: 'fldB3U5JPZHiGDpz0',
  },
};

const AIRTABLE_API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

function airtableHeaders() {
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_API_KEY environment variable is not set');
  }
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Escape single quotes for use inside an Airtable filterByFormula string literal.
function esc(str) {
  return String(str).replace(/'/g, "\\'");
}

async function getBooksForPackage(cat, month) {
  // "month" comes in as YYYY-MM; our Maandpakketten primary field is named "YYYY-MM · cat"
  const naam = `${month} \u00b7 ${cat}`;
  const formula = `{${'Naam'}} = '${esc(naam)}'`;

  const url = `${AIRTABLE_API}/${TABLES.maandpakketten}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const res = await fetch(url, { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Airtable maandpakketten lookup failed: ${res.status}`);
  const data = await res.json();

  const pakket = data.records[0];
  if (!pakket) return [];

  const bookIds = pakket.fields[FIELDS.maandpakketten.boeken] || [];
  if (bookIds.length === 0) return [];

  // Fetch each linked book record. At this scale (4-5 books) parallel GETs are fine;
  // for larger packages, batch via a RECORD_ID()-OR() filterByFormula instead.
  const books = await Promise.all(
    bookIds.map(async (id) => {
      const r = await fetch(`${AIRTABLE_API}/${TABLES.boeken}/${id}`, { headers: airtableHeaders() });
      if (!r.ok) return null;
      const rec = await r.json();
      const attachments = rec.fields[FIELDS.boeken.cover] || [];
      return {
        id: rec.id,
        title: rec.fields[FIELDS.boeken.titel] || '(naamloos)',
        cover: attachments[0] ? attachments[0].url : null,
      };
    })
  );

  return books.filter(Boolean);
}

async function createRating(payload) {
  const fields = {
    [FIELDS.ratings.orderId]: payload.orderId || '',
    [FIELDS.ratings.childId]: payload.childId || '',
    [FIELDS.ratings.kidName]: payload.kidName || '',
    [FIELDS.ratings.categorie]: payload.category,
    [FIELDS.ratings.maand]: payload.month ? `${payload.month}-01` : undefined,
    [FIELDS.ratings.cijfer]: payload.score ? Number(payload.score) : undefined,
    [FIELDS.ratings.boekenRaak]: payload.bookIdsRaak || [],
    [FIELDS.ratings.nietRaakLeeftijd]: (payload.nietRaakRedenen || [])
      .filter((r) => r.reason === 'age')
      .map((r) => r.bookId),
    [FIELDS.ratings.nietRaakSmaak]: (payload.nietRaakRedenen || [])
      .filter((r) => r.reason === 'taste')
      .map((r) => r.bookId),
    [FIELDS.ratings.ingevuldOp]: new Date().toISOString(),
  };
  if (payload.pakketType) {
    fields[FIELDS.ratings.pakketType] = payload.pakketType;
  }

  const res = await fetch(`${AIRTABLE_API}/${TABLES.ratings}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ records: [{ fields }] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Airtable rating write failed: ${res.status} ${errText}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // Allow the Shopify-hosted page (different origin) to call this endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET' && req.query.action === 'books') {
      const { cat, month } = req.query;
      if (!cat || !month) {
        return res.status(400).json({ error: 'cat en month zijn verplicht, bv. ?action=books&cat=6-8&month=2026-07' });
      }
      const books = await getBooksForPackage(cat, month);
      return res.status(200).json({ books });
    }

    if (req.method === 'POST') {
      const payload = req.body;
      if (!payload || !payload.category || !payload.score) {
        return res.status(400).json({ error: 'category en score zijn verplicht in de body' });
      }
      await createRating(payload);
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Onbekend endpoint. Gebruik GET ?action=books of POST.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Interne fout' });
  }
}
