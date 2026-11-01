# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/), versioni secondo [SemVer](https://semver.org/lang/it/).

## [1.0.0] — 2026-11-01

Prima release pubblica.

### Aggiunto

- Server MCP (stdio) con tool `status`, `list_courses`, `list_lessons`, `get_lesson`, `get_transcript`,
  `course_progress`, `sync_course` e tool avanzati `open_page`, `click`, `api_get`, `download`, `download_by_click`.
- Prompt di studio `studia_lezione`, `simula_esame`, `piano_di_studio`.
- CLI: `serve`, `login`, `logout`, `status`, `courses`, `progress`, `sync`.
- Guardia read-only: blocco degli endpoint di tracciamento della frequenza e delle scritture verso l'API studenti,
  nel browser e nelle chiamate dirette; allowlist degli host; service worker bloccati.
- `watchUrl` per aprire una lezione sulla piattaforma; avanzamento separato tra video e test di autovalutazione.
- Notifiche di progresso MCP durante `sync_course`.
- Libreria `core` riusabile (export del pacchetto) per future app.

### Modificato (rispetto al prototipo interno)

- Riscritto in TypeScript strict, con validazione delle risposte API (zod) ed errori tipizzati con codice.
- Sessione spostata nella cartella dati dell'utente (permessi 600/700); workspace configurabile.
- Download e sync in parallelo, scritture atomiche, verifica dei PDF tramite magic number.
- Rinnovo del JWT single-flight; avvio del browser single-flight; retry con backoff sulle GET.
- Catture del traffico API solo su richiesta (`saveCaptures`), mai nella cartella del progetto.
- `api_request` sostituito da `api_get` (solo GET).
