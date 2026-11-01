// Pure functions: no I/O, fully unit-tested.
import { VIDEO_HOST, VTT_HOST } from './platform.js';
import type { ApiLessonItem, ApiLessonRef, Course, Lesson } from './types.js';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  agrave: 'à',
  aacute: 'á',
  egrave: 'è',
  eacute: 'é',
  igrave: 'ì',
  iacute: 'í',
  ograve: 'ò',
  oacute: 'ó',
  ugrave: 'ù',
  uacute: 'ú',
  Agrave: 'À',
  Egrave: 'È',
  Eacute: 'É',
  Igrave: 'Ì',
  Ograve: 'Ò',
  Ugrave: 'Ù',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  euro: '€',
  deg: '°',
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Light HTML → text for short rich-text fields (lesson objectives). */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/\r\n?/g, '\n')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Enrolled courses from the Chamilo portal page: links to `/efs-courses/<CODE>/`. */
export function parseCoursesFromPortal(html: string): Course[] {
  const courses = new Map<string, Course>();
  const re = /href="[^"]*\/efs-courses\/([A-Z0-9]+)\/?"[^>]*>\s*(?:<[^>]+>\s*)*([^<]+?)\s*</g;
  for (const m of html.matchAll(re)) {
    const [, code, title] = m;
    if (!code || !title || courses.has(code)) continue;
    courses.set(code, { code, title: decodeHtmlEntities(title), cfu: null, progress: null, completed: null });
  }
  return [...courses.values()];
}

/** Subtitles live on a sibling host with the same path and a `.vtt` extension. */
export function vttUrl(videoUrl: string | null | undefined): string | null {
  if (!videoUrl?.startsWith(VIDEO_HOST)) return null;
  return VTT_HOST + videoUrl.slice(VIDEO_HOST.length).replace(/\.mp4(\?.*)?$/i, '.vtt');
}

const nullableNum = (v: number | null | undefined): number | null =>
  v === null || v === undefined || Number.isNaN(v) ? null : v;

export function parseLesson(ref: ApiLessonRef, items: readonly ApiLessonItem[]): Lesson {
  const meta = items.find((x) => x.contentType === 'lesson');
  const intro = items.find((x) => x.contentType === 'intro');
  const test = items.find((x) => x.contentType === 'test');
  const teacher = [meta?.teacherName, meta?.teacherSurname].filter(Boolean).join(' ').trim();
  return {
    number: ref.display_order,
    lpId: ref.lp_id,
    title: ref.title.trim(),
    teacher: teacher || null,
    progress: nullableNum(ref.percentage),
    objectives: intro?.description ? htmlToText(intro.description) : null,
    dispensaUrl: meta?.mer_BookUrl || meta?.bookUrl || null,
    selfTest: test ? { title: test.title ?? 'Test', progress: nullableNum(test.percentage) } : null,
    paragraphs: items
      .filter((x) => x.contentType === 'video')
      .map((v, i) => ({
        number: nullableNum(v.paragNumber) ?? i + 1,
        title: (v.title ?? '').trim(),
        durationS: nullableNum(v.duration_s) ?? 0,
        progress: nullableNum(v.percentage),
        videoUrl: v.videoUrl ?? null,
        vttUrl: vttUrl(v.videoUrl),
      }))
      .sort((a, b) => a.number - b.number),
  };
}

/**
 * WebVTT → readable text. Parses cue blocks (so NOTE/STYLE/REGION blocks and cue identifiers are dropped),
 * strips inline tags, removes consecutive duplicate cues and breaks lines at sentence ends.
 */
export function vttToText(vtt: string): string {
  const cues: string[] = [];
  for (const block of vtt.replace(/^﻿/, '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing === -1) continue;
    const text = lines
      .slice(timing + 1)
      .map((l) => decodeHtmlEntities(l.replace(/<[^>]+>/g, '')).trim())
      .filter(Boolean)
      .join(' ');
    if (text && text !== cues[cues.length - 1]) cues.push(text);
  }
  return cues
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/([.!?…])\s+(?=[A-ZÀ-Ý«"“])/g, '$1\n')
    .trim();
}

/** ASCII folder name from a course title: "Diritto penale & co." → "Diritto-penale-co". */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** File-system-safe name that keeps spaces and accents but no reserved characters. */
export function safeFileName(s: string, max = 90): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .replace(/[. ]+$/, '') || 'untitled'
  );
}

/** 657 → "10:57", 3725 → "1:02:05". */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** `exp` claim of a JWT, without verifying it (we only need to know when it expires). */
export function jwtExpiry(token: string): Date | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof exp === 'number' ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

export const isPdf = (buf: Uint8Array): boolean =>
  buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
