# Instagram Lookalike Finder

Vind Instagram-accounts die lijken op een set "seed"-accounts (concurrenten,
influencers) — niet door zelf te gokken wie er op elkaar lijkt, maar door
Instagram's eigen aanbevelingsengine te gebruiken (dezelfde die achter de
"Suggested for you"-carrousel zit) en daar een recommendation graph,
similarity score, land-inschatting en AI-niche-classificatie overheen te
bouwen.

Dit is een op zichzelf staand project, los van de rest van deze repo
(`rating.js`/Airtable is een ander, ongerelateerd stukje Boekadoe-infra).

```
seed accounts  ->  Instagram recommendations (per seed)  ->  recommendation graph
              ->  dedupliceren + similarity score  ->  profiel-enrichment
              ->  land-confidence + AI niche-classificatie  ->  filters  ->  CSV / Sheets
```

## ⚠️ Belangrijk: lees dit voor je een Instagram-account koppelt

Dit gebruikt **ongedocumenteerde, private Instagram-endpoints** (via
[aiograpi](https://github.com/subzeroid/aiograpi)) — geen officiële Meta API.
Dat betekent concreet:

- Het is in strijd met Instagram's Terms of Service.
- Instagram kan deze endpoints op elk moment wijzigen of blokkeren.
- Het account waarmee wordt ingelogd loopt een reëel risico om geflagged,
  rate-limited of geband te worden.

**Gebruik hiervoor een los, opofferbaar (test)account — nooit je hoofdaccount
of een account dat je niet kunt missen.** De adapter beperkt de snelheid
waarmee requests worden gedaan (`IG_MIN/MAX_DELAY_SECONDS`,
`IG_MAX_CONCURRENCY` in `.env`) en hergebruikt één ingelogde sessie
(`data/ig_session.json`) in plaats van steeds opnieuw in te loggen, maar dat
verkleint het risico — het elimineert het niet.

Zonder Instagram-credentials (of met `USE_MOCK_ADAPTER=true`) draait de hele
pipeline tegen een ingebouwde nep-adapter, handig om lokaal te ontwikkelen
of te demonstreren zonder enig IG-risico.

### "challenge_required" bij een verse account+wachtwoord-login

Instagram's private login-endpoint (`accounts/login/`) herkent dit soort
scripted logins vrijwel altijd als een onbekend toestel en blokkeert de
eerste poging(en) met een `native_flow`-checkpoint. aiograpi lost dit type
checkpoint bewust niet automatisch op — nog een keer proberen (ook vanaf
een ander netwerk, of na inloggen in de officiële app) verandert daar
niets aan, want *het inlog-endpoint zelf* triggert de check.

Workaround: **`INSTAGRAM_SESSIONID`** in `.env`. Log normaal in op
instagram.com in een browser (dat verloopt via een veel soepeler flow),
kopieer daarna de `sessionid`-cookie (devtools → Application/Storage →
Cookies → instagram.com) en zet die in `.env`. De adapter gebruikt dan
`login_by_sessionid()` in plaats van `accounts/login/` — geen
device-check, dus geen checkpoint. Die cookie verloopt na verloop van tijd
(grofweg enkele weken); ververs 'm dan opnieuw op dezelfde manier.

Eenmaal ingelogd (via wachtwoord of sessionid) hergebruikt de adapter de
opgeslagen sessie (`data/ig_session.json`) en logt hij niet opnieuw in
zolang die nog geldig is — elke herstart doet dus geen nieuwe
device-login-poging.

## Architectuur

```
frontend/   Next.js — seed-formulier, voortgang, filters, resultatentabel, CSV-export
backend/    FastAPI — Instagram-adapter, recommendation graph, scoring,
            land-classificatie, AI-niche-classificatie (Anthropic), export
```

De Instagram-integratie zit achter één interface
(`backend/app/adapters/base.py: InstagramAdapter`), met twee implementaties:

- `AiograpiAdapter` — echte Instagram-data via aiograpi's `chaining()` (het
  discover/chaining-endpoint achter "Suggested for you").
- `MockAdapter` — deterministische nepdata, geen netwerkverkeer.

Wil je later InstaHarvest of een andere bron toevoegen: implementeer
`InstagramAdapter` opnieuw en wissel hem in `app/adapters/__init__.py`.

## Lokaal draaien

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # vul IG-credentials en/of ANTHROPIC_API_KEY in, of laat leeg voor de mock-adapter
uvicorn app.main:app --reload
```

Draait op `http://localhost:8000`. `GET /health` voor een snelle check,
interactieve API-docs op `/docs`.

Unit tests (scoring + land-classificatie, geen netwerk nodig):

```bash
pytest
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Draait op `http://localhost:3000`.

### Of met Docker Compose (incl. Postgres)

```bash
cp backend/.env.example backend/.env   # invullen
docker compose up --build
```

## Gebruik

1. Open de frontend, voer 5–20 seed-accounts in (usernames, met of zonder
   `@`) en het gewenste aantal resultaten.
2. Klik **FIND LOOKALIKES**. De backend:
   - lost elke seed op naar een Instagram user-id;
   - haalt per seed Instagram's eigen "chaining"-aanbevelingen op;
   - bouwt daarvan een recommendation graph: een kandidaat die door meerdere
     seeds wordt aanbevolen krijgt een hogere **similarity score**;
   - verrijkt de top-kandidaten met profielgegevens;
   - schat land + confidence in (bio-emoji's, plaatsnamen, website-TLD,
     taaldetectie);
   - classificeert de niche via Claude (Anthropic), of laat dit op
     "unknown" staan zonder API-key.
3. Filter op followers, land, niche en zakelijk account.
4. **Export CSV** — kolommen: `username, instagram_url, followers,
   following, bio, category, country, country_confidence, niche,
   similarity_score, seed_overlap, found_via`.

Google Sheets-export (`POST /runs/{id}/export/sheets?spreadsheet_id=...`) is
aanwezig maar staat uit totdat je `GOOGLE_SERVICE_ACCOUNT_JSON` instelt op
een service-account key die als editor is toegevoegd aan de doelsheet.

## Command center / always-on deploy

Deze tool draait niet als losse webapp maar wordt aangeroepen vanuit het
Boekadoe command center, via de backend-API op een always-on Mac Mini
(launchd-service + Cloudflare Tunnel, geen los gehoste frontend nodig). Zie
[`backend/deploy/README.md`](backend/deploy/README.md) voor de setup, en
`API_KEY` in `backend/.env` voor de shared-secret die elke aanroep van
buiten localhost nodig heeft (header `X-API-Key`).

**API-referentie voor het command center:** [`backend/API.md`](backend/API.md)
(interactieve versie op `<base-url>/docs`).

## Bekende beperkingen (V1) / ideeën voor V2

- **Geen jobqueue.** De pipeline draait als achtergrondtaak in hetzelfde
  FastAPI-proces (`BackgroundTasks`). Prima voor V1/één-worker-gebruik; voor
  productie-schaal (meerdere workers, taken die een proces-restart moeten
  overleven) is Celery/RQ + Redis de voor de hand liggende volgende stap.
- **Niche-classificatie is één LLM-call per account.** Werkt prima voor
  honderden accounts; bij duizenden wordt batchen/cachen de moeite waard.
- **Land-classificatie is een heuristiek**, geen garantie — de
  `country_confidence` en `country_signals` per account laten precies zien
  waarop de inschatting is gebaseerd, zodat je zelf kunt beoordelen of je
  die vertrouwt.
- **Geen automatische re-seeding.** Het idee uit de oorspronkelijke schets
  (beste resultaten als nieuwe seeds gebruiken om dieper de graph in te
  crawlen) is bewust niet in V1 gebouwd — dat vermenigvuldigt het aantal
  Instagram-calls (en dus het ban-risico) snel, en verdient een bewuste
  keuze over hoeveel dieper je wilt gaan.
