# De Cage 🎾

Een simpele web app voor padelvereniging **De Cage**.

- **Accounts en profielen.** Naam, niveau (1-10), voorkeurskant en een stukje over jezelf.
- **Speeldagen.** De admin plant ze in, eventueel 4 weken vooruit. Leden melden zich aan met "Ik doe mee".
- **Automatische indeling.** De admin kiest het aantal rondes en klikt op *Genereer wedstrijden*.
- **Scores.** Iedereen kan de score van elke wedstrijd invullen of aanpassen.
- **Wedstrijden beoordelen.** Spelers geven hun eigen partij 1-5 sterren.
- **Ranking.** Een Elo-rating per speler, plus gespeeld, gewonnen en winstpercentage.
- **Spelerspagina.** Statistieken, de laatste wedstrijden en je "beste partner".

De **eerste** persoon die een account maakt, wordt automatisch admin. Een admin kan
anderen ook admin maken via de Admin-pagina.

## Lokaal draaien (bijv. op de Mac Mini)

Je hebt **Node.js 20 of nieuwer** nodig (`node -v`; anders `brew install node`).

```bash
git clone https://github.com/DennisTakeover/boekadoe.git
cd boekadoe
git checkout claude/practical-wozniak-ntgr2h
cd de-cage
npm install
npm run dev        # herstart vanzelf als je code aanpast (of: npm start)
```

Open daarna <http://localhost:3000> en maak als eerste je eigen (admin-)account aan.

Lokaal staat alle data in `de-cage/data/cage.db`: gewoon een SQLite-bestand, er hoeft
niets extra geïnstalleerd te worden. Wil je opnieuw beginnen? Stop de server en
verwijder de map `data/`.

## Online zetten met Vercel + GitHub

Vercel draait de app "serverless". Er is daar geen vaste schijf, dus de database moet
ergens anders staan. We gebruiken **Turso**: gratis, en het is dezelfde SQLite die je
lokaal gebruikt. De code blijft dus gelijk. Alleen twee environment variables verschillen.

1. **Vercel-project aanmaken.** Kies op vercel.com *Add New → Project*, importeer de
   GitHub-repo `boekadoe` en zet **Root Directory** op `de-cage`. Framework Preset is
   "Other", en build-instellingen hoef je niet te wijzigen.
2. **Database koppelen.** Ga in het Vercel-project naar *Storage* (of de *Marketplace*),
   kies **Turso** en maak een database aan. Vercel zet dan zelf `TURSO_DATABASE_URL` en
   `TURSO_AUTH_TOKEN` klaar. Doe je het liever handmatig via turso.tech? Zet die twee
   variabelen dan zelf onder *Settings → Environment Variables*.
3. **Deploy.** Elke `git push` naar GitHub zet daarna automatisch een nieuwe versie online.
4. Maak op de live-site als eerste je eigen account aan: dat wordt admin. Of zet
   `ADMIN_EMAILS=jouw@email.nl` in Vercel.

De tabellen worden bij het eerste bezoek automatisch aangemaakt. Op Vercel staan
cookies automatisch op `Secure` (https).

### Instellingen (environment variables)

| Variabele            | Standaard        | Uitleg                                                     |
|----------------------|------------------|------------------------------------------------------------|
| `TURSO_DATABASE_URL` | –                | Online database. Leeg = lokaal bestand `data/cage.db`       |
| `TURSO_AUTH_TOKEN`   | –                | Token bij de Turso-database                                |
| `ADMIN_EMAILS`       | –                | Komma-gescheiden e-mails die bij registratie admin worden  |
| `PORT`               | `3000`           | Poort lokaal                                               |
| `DB_FILE`            | `data/cage.db`   | Pad naar het lokale databasebestand                        |

## Hoe werkt het indelingsalgoritme?

Zie `matchmaking.js`. Per ronde gebeurt dit:

1. **Wie speelt?** Aanwezigen die vandaag het minst gespeeld hebben, gaan voor. Zo rust
   iedereen eerlijk om de beurt (bijv. 22 man op 5 banen: steeds 2 anderen aan de kant).
2. **Wie op welke baan?** Spelers worden op rating gesorteerd, met een beetje willekeur,
   en per 4 op een baan gezet. Zo speel je tegen mensen van je eigen niveau, maar niet
   elke keer tegen dezelfden.
3. **Welke teams?** Er zijn 3 manieren om 4 spelers in 2 teams te verdelen. Het algoritme
   kiest de meest gelijkwaardige, en geeft strafpunten als je vandaag of op de vorige 2
   speeldagen al met dezelfde partner of tegenstanders speelde.

De rating is Elo. Je start-rating hangt af van je niveau-inschatting (niveau 5 = 1000,
elk niveau is ±50). Na elke ingevulde score stijgen de winnaars en dalen de verliezers,
iets sterker bij een grote winstmarge. De ratings worden steeds opnieuw berekend uit alle
scores. Een verbeterde score klopt dus ook meteen in de ranking.

## Tests

```bash
npm test
```
