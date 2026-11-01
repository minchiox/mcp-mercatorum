import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Ready-made study workflows, shown by MCP clients as slash commands / prompt templates.
// Written in Italian: they are addressed to the student's study session.

const user = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'studia_lezione',
    {
      title: 'Studia una lezione',
      description:
        'Spiegazione guidata di una lezione a partire dalla trascrizione, con domande di verifica.',
      argsSchema: {
        course: z.string().describe('Codice corso'),
        lesson: z.string().describe('Numero lezione'),
      },
    },
    ({ course, lesson }) =>
      user(
        `Usa get_lesson e get_transcript per la lezione ${lesson} del corso ${course}. ` +
          'Poi: 1) riassumi gli obiettivi in 3 punti; 2) spiega i concetti chiave partendo dall’intuizione e poi ' +
          'formalizzando; 3) segnala cosa è più probabile all’esame; 4) fammi 5 domande di verifica, una alla volta, ' +
          'aspettando la mia risposta prima di correggere. Basati solo sulla trascrizione: se qualcosa non è chiaro, dillo.',
      ),
  );

  server.registerPrompt(
    'simula_esame',
    {
      title: 'Simula un esame',
      description: "Simulazione d'esame (orale o scritto) sulle lezioni di un corso.",
      argsSchema: {
        course: z.string().describe('Codice corso'),
        lessons: z.string().optional().describe('Lezioni da includere, es. "1-10" (default: tutte)'),
        mode: z.string().optional().describe('"orale" o "scritto" (default: orale)'),
      },
    },
    ({ course, lessons, mode }) =>
      user(
        `Simula un esame ${mode ?? 'orale'} del corso ${course}${lessons ? ` sulle lezioni ${lessons}` : ''}. ` +
          'Usa list_lessons e get_transcript per ricavare gli argomenti. Fai una domanda alla volta, valuta ogni ' +
          'risposta (corretta / incompleta / errata) con il riferimento alla lezione, e alla fine dammi un voto ' +
          'indicativo in trentesimi e gli argomenti da ripassare.',
      ),
  );

  server.registerPrompt(
    'piano_di_studio',
    {
      title: 'Piano di studio',
      description: 'Pianifica la visione delle lezioni mancanti e il ripasso in base al tempo disponibile.',
      argsSchema: {
        hoursPerWeek: z.string().describe('Ore di studio disponibili a settimana'),
        examDate: z.string().optional().describe('Data esame (AAAA-MM-GG)'),
        course: z.string().optional().describe('Codice corso (default: tutti quelli iniziati)'),
      },
    },
    ({ hoursPerWeek, examDate, course }) =>
      user(
        `Usa course_progress${course ? ` per il corso ${course}` : ''} per vedere cosa mi manca da guardare. ` +
          `Ho ${hoursPerWeek} ore a settimana${examDate ? ` e l’esame il ${examDate}` : ''}. ` +
          'Proponi un calendario settimanale realistico: lezioni da guardare sulla piattaforma (la frequenza la ' +
          'registra solo la visione reale), ripasso con le trascrizioni e simulazioni d’esame prima della data.',
      ),
  );
}
