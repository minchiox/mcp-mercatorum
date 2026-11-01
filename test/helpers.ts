import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FetchedFile, PlatformClient, SessionStatus } from '../src/core/client.js';
import { NotFoundError } from '../src/core/errors.js';
import { parseLesson } from '../src/core/parse.js';
import { ApiLessonItem, ApiLessonRef, type Course, type Lesson } from '../src/core/types.js';

export const fixture = (name: string): string =>
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

export const fixtureJson = <T = unknown>(name: string): T => (JSON.parse(fixture(name)) as { data: T }).data;

export const refs = (): ApiLessonRef[] =>
  fixtureJson<unknown[]>('lesson-refs.json').map((r) => ApiLessonRef.parse(r));
export const items = (): ApiLessonItem[] =>
  fixtureJson<unknown[]>('lesson-items.json').map((r) => ApiLessonItem.parse(r));

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-mercatorum-test-'));
}

export const PDF = Buffer.from('%PDF-1.7\n%fake pdf for tests\n');

export function makeLesson(number: number, overrides: Partial<Lesson> = {}): Lesson {
  return {
    ...parseLesson(
      { lp_id: number, display_order: number, title: `Lezione ${number}`, percentage: 100 },
      items(),
    ),
    ...overrides,
  };
}

/** In-memory PlatformClient: lessons per course and files per URL. Records every fetched URL. */
export class FakeClient implements PlatformClient {
  readonly fetched: string[] = [];

  constructor(
    readonly courses: Course[] = [
      { code: 'ABC123', title: 'Corso di prova', cfu: 9, progress: 50, completed: false },
    ],
    readonly lessons: Record<string, Lesson[]> = { ABC123: [makeLesson(1), makeLesson(2)] },
    readonly files: Record<string, FetchedFile> = {},
  ) {}

  async status(): Promise<SessionStatus> {
    return { loggedIn: true, sessionFile: '/tmp/session.json', tokenExpiresAt: null, hasRefreshToken: true };
  }

  async listCourses(): Promise<Course[]> {
    return this.courses;
  }

  async listLessons(course: string): Promise<Lesson[]> {
    const l = this.lessons[course];
    if (!l) throw new NotFoundError(`Course ${course}`);
    return l;
  }

  async getLesson(course: string, n: number): Promise<Lesson> {
    const l = (await this.listLessons(course)).find((x) => x.number === n);
    if (!l) throw new NotFoundError(`Lesson ${n}`);
    return l;
  }

  async fetchFile(url: string): Promise<FetchedFile | null> {
    this.fetched.push(url);
    return this.files[url] ?? null;
  }
}
