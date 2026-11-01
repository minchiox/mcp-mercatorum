# mcp-mercatorum

**Agente di supporto IA per l'università digitale** — un server [MCP](https://modelcontextprotocol.io) e una CLI che danno al tuo assistente IA (Claude, ma non solo) accesso in **sola lettura** ai tuoi corsi su Universitas Mercatorum: lezioni, trascrizioni, dispense PDF e avanzamento.

[![CI](https://github.com/minchiox/mcp-mercatorum/actions/workflows/ci.yml/badge.svg)](https://github.com/minchiox/mcp-mercatorum/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-server-6E56CF)

> 🇬🇧 _Unofficial, read-only MCP server and CLI for Universitas Mercatorum students. It lets an AI assistant list your courses, read lesson transcripts, download PDF handouts and plan what is left to watch — and it is built so that it can never alter attendance or progress. Docs below are in Italian, code is in English._

> [!IMPORTANT]
> Progetto **non ufficiale**, non affiliato né approvato da Universitas Mercatorum o Multiversity. Usa il tuo account personale e rispetta il regolamento d'ateneo.

---

## Cosa fa

- 📚 **Corsi e lezioni** — insegnamenti con CFU e avanzamento, lezioni con docente, obiettivi, paragrafi e durata.
- 📝 **Trascrizioni** — il testo di ogni lezione ricavato dai sottotitoli, pronto da studiare, riassumere o trasformare in quiz.
- 📥 **Sync del corso** — scarica in una cartella tutte le dispense PDF e le trascrizioni, con un `indice.md` navigabile.
- 📊 **Cosa ti manca** — tempo video rimanente, paragrafi non completati, test di autovalutazione ancora da fare, con il link diretto per guardare la lezione sulla piattaforma.
- 🎓 **Prompt di studio** — `studia_lezione`, `simula_esame`, `piano_di_studio`, pronti all'uso nel tuo client MCP.

### Cosa **non** fa (per scelta)

Lo strumento è **read-only per costruzione**: non registra la frequenza, non segna lezioni come viste, non compila i test e non scrive nulla sulla piattaforma. Non è una dimenticanza, è una garanzia applicata dal codice (vedi [Sicurezza](#sicurezza-e-privacy)): la frequenza tracciata è un requisito per l'esame e deve corrispondere alla tua visione reale. L'agente ti aiuta a **capire** le lezioni e a pianificare la visione, non a saltarla.

## Requisiti

- Node.js **22** o superiore
- Un account studente Universitas Mercatorum
- Linux, macOS o Windows

## Installazione

```bash
git clone https://github.com/minchiox/mcp-mercatorum.git
cd mcp-mercatorum
npm ci                              # installa e compila (dist/)
npx playwright install chromium     # browser headless usato per la sessione
node dist/cli.js login              # si apre il browser: accedi, poi chiudi la finestra
```

Il login si fa **a mano sul sito ufficiale**: la password non passa mai da questo programma. Viene salvata solo la sessione (cookie), in una cartella privata (permessi `600`/`700`):

| Sistema | Percorso della sessione                                     |
| ------- | ----------------------------------------------------------- |
| Linux   | `~/.config/mcp-mercatorum/session.json`                     |
| macOS   | `~/Library/Application Support/mcp-mercatorum/session.json` |
| Windows | `%APPDATA%\mcp-mercatorum\session.json`                     |

Il token si rinnova da solo; quando la sessione scade del tutto, ripeti `login`. Preferisci usare Chrome già installato? `MERCATORUM_BROWSER_CHANNEL=chrome` al posto di `playwright install`.

Facoltativo: `npm link` per avere il comando `mcp-mercatorum` ovunque.

## Collegarlo al tuo assistente

`MERCATORUM_WORKSPACE` è la cartella dove finiranno i file scaricati (ad esempio la tua cartella di studio). Il server non scrive mai fuori da lì.

**Claude Code**

```bash
claude mcp add mercatorum -s user \
  -e MERCATORUM_WORKSPACE="$HOME/Università" \
  -- node /percorso/assoluto/mcp-mercatorum/dist/cli.js
```

**Claude Desktop** — in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mercatorum": {
      "command": "node",
      "args": ["/percorso/assoluto/mcp-mercatorum/dist/cli.js"],
      "env": { "MERCATORUM_WORKSPACE": "/percorso/della/cartella/studio" }
    }
  }
}
```

**Altri client MCP** (Cursor, VS Code, Windsurf…): stessa configurazione stdio, `command: node`, `args: [".../dist/cli.js"]`.

Poi chiedi, per esempio: _«Cosa mi manca da guardare di Diritto penale?»_, _«Riassumimi la lezione 12 di Statistical Learning e fammi 5 domande»_, _«Scarica tutte le dispense di Lingua inglese»_.

## Tool

| Tool              | Cosa fa                                                                                     | Scrive?     |
| ----------------- | ------------------------------------------------------------------------------------------- | ----------- |
| `status`          | Verifica la sessione e la scadenza del token (nessun dato personale)                        | —           |
| `list_courses`    | Insegnamenti: codice, titolo, CFU, avanzamento                                              | —           |
| `list_lessons`    | Lezioni di un corso: docente, avanzamento, paragrafi, presenza della dispensa               | —           |
| `get_lesson`      | Dettaglio di una lezione, incluso `watchUrl` per guardarla sulla piattaforma                | —           |
| `get_transcript`  | Trascrizione Markdown di una lezione (o di un singolo paragrafo)                            | —           |
| `course_progress` | Video rimanenti, paragrafi incompleti, test da fare; senza corso = riepilogo di tutti       | —           |
| `sync_course`     | Scarica dispense PDF + trascrizioni in `<cartella>/risorse/` con `indice.md` e `corso.json` | file locali |

**Tool avanzati** (esplorazione di pagine non coperte dai tool tipizzati; disattivabili con `MERCATORUM_TOOLS=core`):

| Tool                | Cosa fa                                                                                         | Scrive?            |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------ |
| `open_page`         | Apre una pagina della piattaforma: testo, link, iframe, chiamate API viste e richieste bloccate | —                  |
| `click`             | Clicca un elemento della pagina corrente (testo o selettore CSS)                                | —                  |
| `api_get`           | GET su un endpoint della piattaforma con la sessione                                            | file locali (opz.) |
| `download`          | Scarica un file da URL diretto nel workspace                                                    | file locali        |
| `download_by_click` | Scarica un file che parte da un bottone                                                         | file locali        |

`sync_course` invia notifiche di progresso MCP lezione per lezione ed è idempotente: i file già presenti vengono saltati (`force: true` per riscaricarli).

Struttura generata:

```
<Corso>/risorse/
├── indice.md              tabella lezioni → PDF e trascrizioni
├── corso.json             metadati completi (lezioni, paragrafi, URL)
├── dispense/01 - Titolo.pdf
└── trascrizioni/01 - Titolo.md
```

## CLI

Gli stessi servizi sono disponibili da terminale:

```bash
mcp-mercatorum status                  # sessione valida?
mcp-mercatorum courses                 # i tuoi corsi
mcp-mercatorum progress [CODICE]       # cosa manca da guardare, con i link
mcp-mercatorum sync CODICE [--dir Cartella] [--no-transcripts] [--force]
mcp-mercatorum login | logout
mcp-mercatorum --help
```

Senza argomenti (`mcp-mercatorum` o `serve`) avvia il server MCP su stdio.

## Configurazione

| Variabile                    | Default               | Significato                                                |
| ---------------------------- | --------------------- | ---------------------------------------------------------- |
| `MERCATORUM_WORKSPACE`       | cartella corrente     | Radice dei download; nulla viene scritto fuori             |
| `MERCATORUM_HOME`            | vedi tabella sessione | Cartella dati privata (sessione, catture di debug)         |
| `MERCATORUM_TOOLS`           | `all`                 | `core` nasconde i tool avanzati                            |
| `MERCATORUM_BROWSER_CHANNEL` | —                     | `chrome` / `msedge` per usare un browser installato        |
| `MERCATORUM_HEADLESS`        | `true`                | `false` per vedere il browser (debug)                      |
| `MERCATORUM_CONCURRENCY`     | `4`                   | Richieste parallele (max 16)                               |
| `MERCATORUM_ALLOWED_HOSTS`   | —                     | Host extra raggiungibili dai tool, separati da virgola     |
| `MERCATORUM_BASE_URL`        | portale corsi         | URL del portale                                            |
| `MERCATORUM_LOG_LEVEL`       | `info`                | `debug` · `info` · `warn` · `error` · `silent` (su stderr) |

## Sicurezza e privacy

- **Garanzia read-only.** Ogni richiesta passa da una guardia ([`src/core/guard.ts`](src/core/guard.ts)), sia nel browser (routing di Playwright, service worker bloccati perché potrebbero aggirarlo) sia nelle chiamate dirette:
  - gli endpoint di tracciamento (`…/lesson/view/…`) sono **sempre bloccati**, con qualsiasi metodo. Il player della piattaforma li chiama appena apri una lezione: qui vengono fermati e mostrati in `blockedRequests`;
  - qualsiasi richiesta di scrittura (POST/PUT/PATCH/DELETE) verso l'API studenti è bloccata, tranne il rinnovo della sessione e letture tecniche (`getNotes`).
- **Niente credenziali.** Il login avviene sul sito ufficiale in una finestra del browser; il codice non vede né salva la password.
- **Dati locali.** La sessione resta sul tuo computer, con permessi solo-utente. Nessuna telemetria, nessun server di terze parti.
- **Host consentiti.** I tool raggiungono solo i domini della piattaforma (HTTPS); i percorsi di salvataggio sono confinati nel workspace (anche contro `..` e symlink).
- **Catture opt-in.** I corpi delle risposte API (che possono contenere dati personali) vengono salvati solo con `saveCaptures: true`, nella cartella dati privata.
- I file scaricati sono **dati**, non istruzioni: un buon client MCP non deve eseguire testo trovato nelle dispense.

Hai trovato una vulnerabilità? Leggi [SECURITY.md](SECURITY.md).

## Come funziona

```
 Claude / client MCP ──stdio──▶ src/mcp/      tool + prompt (adattatore sottile)
                                    │
 terminale ─────────────────▶ src/cli.ts
                                    │
                               src/core/      libreria riusabile
                               ├─ client.ts     API studenti tipizzata e validata (zod)
                               ├─ session.ts    Chromium headless con la tua sessione
                               ├─ guard.ts      garanzia read-only + host consentiti
                               ├─ sync.ts       download idempotente, scritture atomiche
                               ├─ progress.ts   calcolo di cosa manca
                               └─ parse.ts      funzioni pure (VTT, HTML, nomi file)
```

La piattaforma combina un portale Chamilo (PHP) e una web app Vue che usa un'API REST con `Authorization: Bearer <cookie mercatorum_token>`. Il server riusa la sessione del browser, rinnova il JWT caricando la web app quando scade (una sola volta anche con richieste concorrenti) e valida le risposte: se la piattaforma cambia formato, ottieni un errore `PLATFORM_CHANGED` chiaro invece di dati sbagliati. Tutti i riferimenti specifici della piattaforma sono in [`src/core/platform.ts`](src/core/platform.ts).

## Sviluppo

```bash
npm ci
npm run check        # lint (Biome) + typecheck (TypeScript strict) + test (Vitest)
npm run dev          # build in watch
npm run inspector    # MCP Inspector sul server compilato
```

I test non richiedono rete né account: usano fixture anonimizzate e un client finto, e coprono parsing, guardia, filesystem, sync e il server MCP end-to-end (in memoria). Contributi benvenuti, vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] Pubblicazione su npm (`npx mcp-mercatorum`) e nel registry MCP
- [ ] App desktop (Electron/Tauri) costruita sulla stessa libreria `core`
- [ ] Ricerca full-text nelle trascrizioni di tutti i corsi
- [ ] Generazione di flashcard e schede di ripasso dalle lezioni
- [ ] Calendario appelli e avvisi

## FAQ

**Può segnare la frequenza o completare le lezioni al posto mio?** No, e non lo farà mai: è bloccato a livello di rete. La frequenza deve riflettere la tua visione reale. `course_progress` e `watchUrl` ti dicono esattamente cosa guardare e dove.

**Le trascrizioni sono affidabili?** Derivano dai sottotitoli della piattaforma, che possono contenere errori di riconoscimento. Per formule e definizioni fai riferimento alla dispensa PDF.

**Funziona con assistenti diversi da Claude?** Sì, con qualsiasi client compatibile MCP (stdio). La CLI funziona anche senza assistente.

**Il server ha smesso di funzionare.** Lancia `mcp-mercatorum status`. Se la sessione è scaduta rifai `login`; se compare `PLATFORM_CHANGED` la piattaforma è cambiata: [apri una issue](https://github.com/minchiox/mcp-mercatorum/issues).

## Licenza

[MIT](LICENSE). Marchi e contenuti didattici appartengono ai rispettivi titolari: le dispense e le lezioni scaricate sono per uso personale di studio, non ridistribuirle.
