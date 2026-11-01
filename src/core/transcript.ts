import type { PlatformClient } from './client.js';
import { formatDuration, vttToText } from './parse.js';
import { mapPool } from './pool.js';
import type { Lesson } from './types.js';

/** Transcript per paragraph (same order as `lesson.paragraphs`); null when subtitles are unavailable. */
export async function fetchTranscripts(
  client: PlatformClient,
  lesson: Lesson,
  concurrency = 4,
): Promise<(string | null)[]> {
  return mapPool(lesson.paragraphs, concurrency, async (p) => {
    if (!p.vttUrl) return null;
    const file = await client.fetchFile(p.vttUrl);
    if (!file) return null;
    const text = vttToText(file.body.toString('utf8'));
    return text || null;
  });
}

export function renderLessonMarkdown(lesson: Lesson, texts: readonly (string | null)[]): string {
  const out = [`# Lezione ${lesson.number} — ${lesson.title}`, ''];
  if (lesson.teacher) out.push(`Docente: ${lesson.teacher}`, '');
  if (lesson.objectives) out.push('## Obiettivi', '', lesson.objectives, '');
  lesson.paragraphs.forEach((p, i) => {
    out.push(`## ${lesson.number}.${p.number} ${p.title} (${formatDuration(p.durationS)})`, '');
    out.push(texts[i] ?? '_Trascrizione non disponibile._', '');
  });
  return out.join('\n');
}
