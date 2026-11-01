import fs from 'node:fs';
import path from 'node:path';
import type { PlatformClient } from './client.js';
import { formatError } from './errors.js';
import { writeFileAtomic } from './fs-safe.js';
import { formatDuration, isPdf, safeFileName } from './parse.js';
import { mapPool } from './pool.js';
import { fetchTranscripts, renderLessonMarkdown } from './transcript.js';
import type { Lesson } from './types.js';

export interface SyncOptions {
  course: string;
  title: string;
  /** Course folder; files go to `<dir>/risorse/`. */
  dir: string;
  force?: boolean;
  transcripts?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface SyncReport {
  lessons: number;
  dispense: number;
  transcripts: number;
  skipped: number;
  missing: string[];
  errors: string[];
}

interface LessonFiles {
  dispensaFile?: string;
  transcriptFile?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Downloads every lesson's PDF handout and subtitle transcript into `<dir>/risorse/`,
 * then writes `indice.md` and `corso.json`. Idempotent: existing files are kept unless `force`.
 * One failing lesson never aborts the others; failures are listed in the report.
 */
export async function syncCourse(client: PlatformClient, opts: SyncOptions): Promise<SyncReport> {
  const { course, title, dir, force = false, transcripts = true, concurrency = 4, onProgress } = opts;
  const res = path.join(dir, 'risorse');
  const dispDir = path.join(res, 'dispense');
  const trDir = path.join(res, 'trascrizioni');

  const lessons = await client.listLessons(course);
  const report: SyncReport = {
    lessons: lessons.length,
    dispense: 0,
    transcripts: 0,
    skipped: 0,
    missing: [],
    errors: [],
  };
  // Several lessons can share one handout: download it once, under the first lesson's name.
  const pdfOwner = new Map<string, Lesson>();
  for (const l of lessons) if (l.dispensaUrl && !pdfOwner.has(l.dispensaUrl)) pdfOwner.set(l.dispensaUrl, l);

  const baseName = (l: Lesson) => `${pad(l.number)} - ${safeFileName(l.title)}`;
  let done = 0;

  const files = await mapPool(lessons, concurrency, async (l): Promise<LessonFiles> => {
    const out: LessonFiles = {};
    try {
      if (!l.dispensaUrl) {
        report.missing.push(`dispensa lezione ${l.number} (nessun link)`);
      } else if (pdfOwner.get(l.dispensaUrl) === l) {
        const file = path.join(dispDir, `${baseName(l)}.pdf`);
        if (fs.existsSync(file) && !force) {
          report.skipped++;
        } else {
          const got = await client.fetchFile(l.dispensaUrl);
          if (got && isPdf(got.body)) {
            writeFileAtomic(file, got.body);
            report.dispense++;
          } else {
            report.missing.push(`dispensa lezione ${l.number}`);
          }
        }
        if (fs.existsSync(file)) out.dispensaFile = path.relative(res, file);
      }

      if (transcripts && l.paragraphs.length) {
        const file = path.join(trDir, `${baseName(l)}.md`);
        if (fs.existsSync(file) && !force) {
          report.skipped++;
        } else {
          const texts = await fetchTranscripts(client, l, 2);
          texts.forEach((t, i) => {
            if (t === null) report.missing.push(`trascrizione ${l.number}.${l.paragraphs[i]?.number}`);
          });
          writeFileAtomic(file, renderLessonMarkdown(l, texts));
          report.transcripts++;
        }
        out.transcriptFile = path.relative(res, file);
      }
    } catch (err) {
      report.errors.push(`lezione ${l.number}: ${formatError(err)}`);
    } finally {
      onProgress?.(++done, lessons.length, `Lezione ${l.number}: ${l.title}`);
    }
    return out;
  });

  // Shared handouts point to the file of the lesson that owns them.
  const byUrl = new Map<string, string | undefined>();
  lessons.forEach((l, i) => {
    if (l.dispensaUrl && pdfOwner.get(l.dispensaUrl) === l) byUrl.set(l.dispensaUrl, files[i]?.dispensaFile);
  });
  const enriched = lessons.map((l, i) => ({
    ...l,
    dispensaFile: (l.dispensaUrl && byUrl.get(l.dispensaUrl)) || null,
    transcriptFile: files[i]?.transcriptFile ?? null,
  }));

  const syncedAt = new Date();
  writeFileAtomic(
    path.join(res, 'corso.json'),
    `${JSON.stringify({ course, title, syncedAt: syncedAt.toISOString(), lessons: enriched }, null, 2)}\n`,
  );
  writeFileAtomic(path.join(res, 'indice.md'), renderIndex(course, title, enriched, syncedAt));
  report.missing.sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
  return report;
}

/** Markdown link target: encode spaces and parentheses so the link survives every renderer. */
const mdLink = (p: string) =>
  encodeURI(p.split(path.sep).join('/')).replace(/\(/g, '%28').replace(/\)/g, '%29');

export function renderIndex(
  course: string,
  title: string,
  lessons: readonly (Lesson & { dispensaFile: string | null; transcriptFile: string | null })[],
  syncedAt: Date,
): string {
  const rows = lessons.map((l) => {
    const dur = l.paragraphs.reduce((s, p) => s + p.durationS, 0);
    const disp = l.dispensaFile ? `[PDF](${mdLink(l.dispensaFile)})` : '—';
    const tr = l.transcriptFile ? `[testo](${mdLink(l.transcriptFile)})` : '—';
    const name = l.title.replace(/\|/g, '\\|');
    return `| ${l.number} | ${name} | ${l.paragraphs.length} | ${formatDuration(dur)} | ${disp} | ${tr} |`;
  });
  return [
    `# ${title} (${course}) — indice lezioni`,
    '',
    `Sincronizzato il ${syncedAt.toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}.`,
    '',
    '| # | Lezione | Paragrafi | Durata | Dispensa | Trascrizione |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}
