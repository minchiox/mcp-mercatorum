import { z } from 'zod';

// ---- Domain model (what tools and the future app consume) ----

export interface Course {
  code: string;
  title: string;
  cfu: number | null;
  /** 0–100 as reported by the platform; null when the course has not been started. */
  progress: number | null;
  completed: boolean | null;
}

export interface Paragraph {
  number: number;
  title: string;
  durationS: number;
  progress: number | null;
  videoUrl: string | null;
  vttUrl: string | null;
}

export interface SelfTest {
  title: string;
  progress: number | null;
}

export interface Lesson {
  number: number;
  lpId: number;
  title: string;
  teacher: string | null;
  progress: number | null;
  objectives: string | null;
  dispensaUrl: string | null;
  selfTest: SelfTest | null;
  paragraphs: Paragraph[];
}

// ---- Raw API schemas: lenient (unknown keys kept, most fields optional) but explicit about what we use ----

const num = z.coerce.number();
const optStr = z.string().nullish();

export const ApiEnvelope = <T extends z.ZodType>(data: T) => z.looseObject({ data });

export const ApiCourse = z.looseObject({
  code: z.string(),
  title: z.string(),
  cfu: num.nullish(),
  progress: num.nullish(),
  completed: z.boolean().nullish(),
});
export type ApiCourse = z.infer<typeof ApiCourse>;

export const ApiLessonRef = z.looseObject({
  lp_id: num,
  display_order: num,
  title: z.string(),
  percentage: num.nullish(),
});
export type ApiLessonRef = z.infer<typeof ApiLessonRef>;

export const ApiLessonItem = z.looseObject({
  contentType: z.string(),
  title: optStr,
  description: optStr,
  // video
  paragNumber: num.nullish(),
  duration_s: num.nullish(),
  videoUrl: optStr,
  percentage: num.nullish(),
  // lesson metadata
  teacherName: optStr,
  teacherSurname: optStr,
  mer_BookUrl: optStr,
  bookUrl: optStr,
});
export type ApiLessonItem = z.infer<typeof ApiLessonItem>;
