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

Je hebt alleen **Node.js 22.5 of nieuwer** nodig. Er zijn geen npm-packages en geen
`npm install`. De database is SQLite en zit ingebouwd in Node.

```bash
node -v                # moet v22.5 of hoger zijn (anders: brew install node)
git clone https://github.com/DennisTakeover/boekadoe.git
cd boekadoe
git checkout claude/practical-wozniak-ntgr2h
cd de-cage
npm start
```

Open daarna <http://localhost:3000> en maak als eerste je eigen (admin-)account aan.

Alle data staat in `de-cage/data/cage.db`. Maak daar af en toe een kopie van als backup.

### Instellingen (optioneel, via environment variables)

| Variabele       | Standaard        | Uitleg                                                      |
|-----------------|------------------|-------------------------------------------------------------|
| `PORT`          | `3000`           | Poort van de webserver                                      |
| `DB_FILE`       | `data/cage.db`   | Pad naar de database                                        |
| `ADMIN_EMAILS`  | –                | Komma-gescheiden e-mails die bij registratie admin worden   |
| `SECURE_COOKIE` | –                | Zet op `1` zodra de app via https draait                    |

Wil je dat de andere leden erbij kunnen? Dan moet de app online komen. Dat kan met een
Cloudflare Tunnel vanaf de Mac Mini (zie de launchd-setup in `instagram-lookalike-finder`)
of via een host als Railway. Zet dan `SECURE_COOKIE=1`.

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
