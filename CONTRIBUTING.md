# Contribuire

Grazie dell'interesse! Il progetto è pensato per gli studenti: segnalazioni, idee e pull request sono benvenute.

## Setup

```bash
git clone https://github.com/minchiox/mcp-mercatorum.git
cd mcp-mercatorum
npm ci
npm run check   # lint + typecheck + test: deve passare prima di ogni PR
```

Per provare contro la piattaforma reale serve un account: `npx playwright install chromium`, poi `node dist/cli.js login`
e `npm run inspector`.

## Regole del progetto

1. **Read-only, sempre.** Non verranno accettate modifiche che registrano frequenza o avanzamento, completano test,
   o scrivono in altro modo sulla piattaforma. Nuove chiamate devono essere GET o passare dalla guardia
   (`src/core/guard.ts`), con un test che lo dimostri.
2. **Niente dati personali.** Non committare sessioni, catture di traffico, dispense o trascrizioni. Le fixture in
   `test/fixtures/` devono essere inventate o anonimizzate (nomi, codici, URL).
3. **Platform-specific in un posto solo.** URL, endpoint e pattern della piattaforma vanno in `src/core/platform.ts`.
4. **Core indipendente da MCP.** La logica va in `src/core/` (riusabile dalla futura app); `src/mcp/` e `src/cli.ts`
   restano adattatori sottili.
5. **Test.** Ogni bug fix porta un test che fallisce senza il fix. Le funzioni pure vanno in `parse.ts` o simili.
6. **Stdout è del protocollo.** Nel server non scrivere su stdout: usa il logger (stderr).

## Stile

- TypeScript strict; formattazione e lint con Biome (`npm run lint:fix`).
- Codice, identificatori e commenti in inglese; documentazione per gli utenti in italiano.
- Commit in stile [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).

## Quando la piattaforma cambia

Se compare `PLATFORM_CHANGED`, apri una issue con l'endpoint e il messaggio d'errore (senza dati personali).
Per indagare usa `open_page` con `saveCaptures: true`: le catture finiscono nella cartella dati privata, non nel
repository.
