import type { Lesson } from './types.js';

export interface LessonProgress {
  number: number;
  lpId: number;
  title: string;
  /** Platform percentage: counts every item of the lesson, self-test included. */
  progress: number;
  remainingS: number;
  /** Paragraphs not fully watched, as "n. title". */
  pendingParagraphs: string[];
  selfTestDone: boolean | null;
}

export interface CourseProgress {
  lessons: number;
  /** Lessons whose videos are all fully watched. */
  watchedLessons: number;
  totalS: number;
  remainingS: number;
  /** Share of video time watched, duration-weighted, 0–100. */
  videoPercent: number;
  /** Lessons with videos still to watch. */
  pending: LessonProgress[];
  /** Numbers of the lessons whose self-assessment test is not done yet. */
  selfTestsPending: number[];
}

const clampPct = (p: number | null): number => Math.min(100, Math.max(0, p ?? 0));

/**
 * What is left to watch and which self-tests are still open, from the percentages the platform reports.
 * Purely informational: it helps plan real viewing, it never changes anything.
 */
export function computeProgress(lessons: readonly Lesson[]): CourseProgress {
  let totalS = 0;
  let remainingS = 0;
  const pending: LessonProgress[] = [];
  const selfTestsPending: number[] = [];
  for (const l of lessons) {
    let lessonRemaining = 0;
    const pendingParagraphs: string[] = [];
    for (const p of l.paragraphs) {
      totalS += p.durationS;
      lessonRemaining += p.durationS * (1 - clampPct(p.progress) / 100);
      if (clampPct(p.progress) < 100) pendingParagraphs.push(`${p.number}. ${p.title}`);
    }
    remainingS += lessonRemaining;
    const selfTestDone = l.selfTest ? clampPct(l.selfTest.progress) >= 100 : null;
    if (selfTestDone === false) selfTestsPending.push(l.number);
    if (pendingParagraphs.length) {
      pending.push({
        number: l.number,
        lpId: l.lpId,
        title: l.title,
        progress: clampPct(l.progress),
        remainingS: Math.round(lessonRemaining),
        pendingParagraphs,
        selfTestDone,
      });
    }
  }
  return {
    lessons: lessons.length,
    watchedLessons: lessons.length - pending.length,
    totalS: Math.round(totalS),
    remainingS: Math.round(remainingS),
    videoPercent: totalS ? Math.floor((100 * (totalS - remainingS)) / totalS) : 0,
    pending,
    selfTestsPending,
  };
}
