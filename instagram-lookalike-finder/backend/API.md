# API-referentie — Instagram Lookalike Finder

Voor het command center (of elke andere externe client) om deze tool aan te
roepen. Interactieve docs (Swagger UI, kan direct calls uitproberen) staan
altijd op `<base-url>/docs` — deze pagina is de compacte referentie ernaast.

## Base URL & auth

```
Base URL: <jouw cloudflared-tunnel-URL>   (lokaal: http://localhost:8000)
Header:   X-API-Key: <waarde uit backend/.env API_KEY>
```

Elke request behalve `GET /health` vereist die header — zonder (of met een
foute) key krijg je `401`. CSV-export via een gewone link kan geen custom
header sturen; daar mag de key ook als querystring: `?api_key=...`.

## Het model: 2 fases, async via polling

Een "run" doorloopt twee **los te triggeren** fases:

```
POST /runs                    -> status: queued -> discovering -> discovered
POST /runs/{id}/matchmaking   -> status: matchmaking -> done
```

Beide draaien als achtergrondtaak — de POST-call geeft direct de (nog lopende)
`Run` terug; poll `GET /runs/{id}` (elke ~2s is prima) tot de status niet meer
`discovering`/`matchmaking` is. Kandidaten zijn al te lezen zodra de status
`discovered` is (fase 1 klaar), nog zonder AI-niche-classificatie
(`niche_primary` is dan `null`).

| status | betekenis |
|---|---|
| `queued` | run aangemaakt, nog niet gestart |
| `discovering` | fase 1 bezig — seeds resolven, IG-aanbevelingen ophalen, profielen verrijken |
| `discovered` | fase 1 klaar — kandidaten compleet, nog geen AI-classificatie |
| `matchmaking` | fase 2 bezig — Claude classificeert niche/matchmaking per kandidaat |
| `done` | fase 2 klaar |
| `error` | zie `error_message` op de Run |

`progress_stage` / `progress_current` / `progress_total` geven fijnmazige
voortgang binnen de actieve fase.

## Endpoints

### `POST /runs` — fase 1: data ophalen starten

```json
// Request
{ "seeds": ["concurrent1", "influencer2"], "desired_results": 50 }

// Response 200 (direct, run loopt nog)
{
  "id": "a1b2c3...", "created_at": "...", "seeds": [...], "desired_results": 50,
  "status": "queued", "progress_stage": "", "progress_current": 0, "progress_total": 0,
  "error_message": null
}
```
`desired_results`: 1–5000. `seeds`: usernames met of zonder `@`, min. 1.

### `GET /runs` — laatste 50 runs

Response: array van hetzelfde object als hierboven (`Run`).

### `GET /runs/{id}` — status van één run

Zelfde `Run`-object. `404` als de id niet bestaat.

### `POST /runs/{id}/matchmaking` — fase 2: AI-classificatie starten

Alleen mogelijk als status `discovered` of `done` is (`409` anders, met
duidelijke boodschap). Kan dus ook herhaald worden op een `done`-run om
opnieuw te classificeren (bv. na een prompt-aanpassing) — dat kost geen
Instagram-calls, alleen Anthropic-calls.

### `GET /runs/{id}/candidates` — de resultatenlijst

Query-params (allemaal optioneel, te combineren):

| param | type | betekenis |
|---|---|---|
| `min_followers` / `max_followers` | int | follower-range |
| `countries` | string | comma-separated, bv. `Netherlands,Belgium` |
| `niches` | string | comma-separated niche-labels |
| `business_only` | bool | alleen `is_business=true` |
| `min_score` | int | minimale `similarity_score` |

Response: array van `Candidate`-objecten, gesorteerd op `similarity_score`
aflopend. **Alle 33 publieke Instagram-velden zitten erin** (alles wat
`user_info()` teruggeeft), plus onze afgeleide velden:

```json
{
  "username": "voorbeeld_account",
  "full_name": "Voorbeeld Account",
  "followers": 48714, "following": 1234, "posts": 512,
  "biography": "Mama van twee | Amsterdam", "external_url": "https://...",
  "category": "Blogger", "category_name": "Blogger",
  "is_verified": false, "is_business": true, "is_private": false,
  "profile_pic_url": "https://...", "profile_pic_url_hd": "https://...",
  "bio_links": [{"title": "Shop", "url": "https://..."}],
  "account_type": 3, "account_type_name": "creator",
  "business_category_name": "Retail", "business_contact_method": "EMAIL",
  "public_email": "info@voorbeeld.nl",
  "public_phone_country_code": "31", "public_phone_number": "612345678",
  "contact_phone_number": "+31612345678",
  "address_street": "Voorbeeldstraat 1", "city_name": "Amsterdam",
  "city_id": "123", "zip_code": "1012 AB",
  "latitude": 52.3676, "longitude": 4.9041, "instagram_location_id": "456",
  "has_threads_badge": false, "threads_badge_label": null,
  "has_broadcast_channel": true, "interop_messaging_user_fbid": "1784...",

  "similarity_score": 62, "seed_overlap": 3,
  "found_via": ["concurrent1", "influencer2"],
  "country": "Netherlands", "country_confidence": 98,
  "niche_primary": "family_lifestyle", "niche_secondary": "interior_design",
  "is_influencer": true, "commercial_potential": 0.72
}
```

Velden die (nog) niet publiek zijn ingevuld door het account komen terug als
`null` (contact/locatie-velden staan bij de meeste persoonlijke accounts
bijvoorbeeld leeg — dat is normaal, geen bug).

### `GET /runs/{id}/export.csv` — zelfde data + filters als CSV

Zelfde query-params als `/candidates`. `Content-Disposition: attachment`.

### `POST /runs/{id}/export/sheets?spreadsheet_id=...`

Optioneel, alleen actief als `GOOGLE_SERVICE_ACCOUNT_JSON` is ingesteld
(anders `501`). `{"url": "<sheet-url>"}` bij succes.

### `GET /health`

`{"ok": true}`, geen auth nodig — voor uptime-checks.

## Voorbeeldflow (curl)

```bash
KEY="..."
BASE="https://<tunnel-url>"

# 1. Fase 1 starten
RUN_ID=$(curl -s -X POST "$BASE/runs" -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"seeds": ["concurrent1", "concurrent2"], "desired_results": 50}' | jq -r .id)

# 2. Pollen tot 'discovered'
while [ "$(curl -s -H "X-API-Key: $KEY" $BASE/runs/$RUN_ID | jq -r .status)" != "discovered" ]; do sleep 2; done

# 3. Fase 2 (AI matchmaking) starten
curl -s -X POST "$BASE/runs/$RUN_ID/matchmaking" -H "X-API-Key: $KEY"

# 4. Pollen tot 'done', dan resultaten ophalen
while [ "$(curl -s -H "X-API-Key: $KEY" $BASE/runs/$RUN_ID | jq -r .status)" != "done" ]; do sleep 2; done
curl -s -H "X-API-Key: $KEY" "$BASE/runs/$RUN_ID/candidates?min_followers=5000&business_only=true"
```

## Foutafhandeling

| status | wanneer |
|---|---|
| `400` | lege/ongeldige `seeds` bij het aanmaken van een run |
| `401` | ontbrekende/foute `X-API-Key` |
| `404` | run-id bestaat niet |
| `409` | matchmaking getriggerd vóór fase 1 klaar is |
| `501` | Google Sheets-export niet geconfigureerd |

Een individuele run die faalt (bv. geen enkele seed te resolven, of
Instagram geeft niks terug) krijgt `status: "error"` met `error_message` —
geen HTTP-foutcode op de status-poll zelf, dat blijft gewoon `200`.
