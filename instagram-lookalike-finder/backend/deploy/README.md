# Mac Mini deploy: always-on service + Cloudflare Tunnel

Doel: de backend draait als systeemservice op deze Mac Mini (start bij
inloggen, herstart vanzelf bij een crash) en is via een stabiele HTTPS-URL
bereikbaar voor het command center, zonder poorten open te zetten op de
router.

## 1. launchd-service (always-on + auto-restart)

```bash
mkdir -p ~/Library/LaunchAgents
cp backend/deploy/nl.boekadoe.instagram-lookalike-backend.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nl.boekadoe.instagram-lookalike-backend.plist
launchctl kickstart -k gui/$(id -u)/nl.boekadoe.instagram-lookalike-backend
```

Check dat 'ie draait:

```bash
curl -s http://localhost:8000/health
tail -f backend/logs/service.out.log backend/logs/service.err.log
```

**Na elke code-wijziging** (dit is geen `--reload`-devserver meer):

```bash
launchctl kickstart -k gui/$(id -u)/nl.boekadoe.instagram-lookalike-backend
```

Service weer verwijderen:

```bash
launchctl bootout gui/$(id -u)/nl.boekadoe.instagram-lookalike-backend
```

Let op: dit is een *LaunchAgent* (start bij inloggen als jouw gebruiker) —
zet de Mac Mini op auto-login als 'ie ook moet doorstarten na een
stroomstoring/reboot zonder dat iemand fysiek inlogt.

## 2. Cloudflare Tunnel (naar buiten ontsluiten)

```bash
brew install cloudflared
```

**Snel testen** (tijdelijke URL, verandert bij elke herstart — genoeg om de
koppeling met het command center te verifiëren):

```bash
cloudflared tunnel --url http://localhost:8000
```

Geeft een regel als `https://iets-random-woorden.trycloudflare.com` — dat is
de URL die het command center aanroept (met de `X-API-Key` header, zie
hieronder).

**Als always-on service** (geen open terminal meer nodig, herstart vanzelf
bij een crash) — nog steeds een *quick tunnel*, dus de URL verandert nog
steeds bij elke herstart:

```bash
cp backend/deploy/nl.boekadoe.instagram-lookalike-tunnel.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nl.boekadoe.instagram-lookalike-tunnel.plist
launchctl kickstart -k gui/$(id -u)/nl.boekadoe.instagram-lookalike-tunnel
```

Huidige URL opzoeken (na elke herstart verandert 'ie):

```bash
grep -o 'https://[a-z-]*\.trycloudflare\.com' backend/logs/tunnel.out.log | tail -1
```

Service herstarten / stoppen:

```bash
launchctl kickstart -k gui/$(id -u)/nl.boekadoe.instagram-lookalike-tunnel   # herstart (nieuwe URL!)
launchctl bootout gui/$(id -u)/nl.boekadoe.instagram-lookalike-tunnel        # stoppen
```

**Permanent** (stabiele URL, bv. `api-lookalikes.boekadoe.nl`) — vereist een
domein dat al in jullie Cloudflare-account zit:

```bash
cloudflared tunnel login
cloudflared tunnel create boekadoe-lookalike-api
cloudflared tunnel route dns boekadoe-lookalike-api api-lookalikes.boekadoe.nl
```

Maak dan `~/.cloudflared/config.yml`:

```yaml
tunnel: boekadoe-lookalike-api
credentials-file: /Users/area51-bot/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: api-lookalikes.boekadoe.nl
    service: http://localhost:8000
  - service: http_status:404
```

En zet 'm ook als launchd-service (`cloudflared service install`) zodat de
tunnel zelf ook auto-restart/always-on is.

## 3. Command center koppelen

Command center roept aan met:

```
GET/POST https://<tunnel-url>/runs...
Header: X-API-Key: <waarde uit backend/.env API_KEY>
```

Update `CORS_ORIGINS` in `backend/.env` met het exacte domein van het
command center als het rechtstreeks vanuit de browser van gebruikers aanroept
(niet nodig als het command center server-side aanroept).
