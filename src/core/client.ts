import { z } from 'zod';
import { HttpError, NotFoundError, PlatformChangedError, SessionExpiredError } from './errors.js';
import { type Logger, silentLogger } from './logger.js';
import { jwtExpiry, parseCoursesFromPortal, parseLesson } from './parse.js';
import { API_BASE, API_PATHS, COURSE_CODE_RE, REFRESH_COOKIE, SPA_HOME, TOKEN_COOKIE } from './platform.js';
import { mapPool } from './pool.js';
import { type BrowserSession, settle } from './session.js';
import { ApiCourse, ApiEnvelope, ApiLessonItem, ApiLessonRef, type Course, type Lesson } from './types.js';

export interface FetchedFile {
  body: Buffer;
  contentType: string;
}

export interface SessionStatus {
  loggedIn: boolean;
  sessionFile: string;
  tokenExpiresAt: string | null;
  hasRefreshToken: boolean;
  reason?: string;
}

/** The read-only operations the MCP tools and the sync need. Implemented over HTTP below, faked in tests. */
export interface PlatformClient {
  status(): Promise<SessionStatus>;
  listCourses(): Promise<Course[]>;
  listLessons(course: string): Promise<Lesson[]>;
  getLesson(course: string, lessonNumber: number): Promise<Lesson>;
  /** null on 4xx (missing file); throws on network/5xx errors. */
  fetchFile(url: string): Promise<FetchedFile | null>;
}

export function assertCourseCode(code: string): string {
  const c = code.trim().toUpperCase();
  if (!COURSE_CODE_RE.test(c)) throw new NotFoundError(`Course "${code}" (invalid code)`);
  return c;
}

const REF_CACHE_TTL_MS = 60_000;

export class MercatorumClient implements PlatformClient {
  private refreshing: Promise<void> | undefined;
  private readonly refCache = new Map<string, { at: number; refs: Promise<ApiLessonRef[]> }>();

  constructor(
    private readonly session: BrowserSession,
    private readonly log: Logger = silentLogger,
  ) {}

  async status(): Promise<SessionStatus> {
    const base = {
      sessionFile: this.session.config.sessionFile,
      tokenExpiresAt: null,
      hasRefreshToken: false,
    };
    if (!this.session.hasSession()) return { ...base, loggedIn: false, reason: 'no saved session' };
    try {
      await this.apiGet(API_PATHS.coursesInProgress, z.array(z.unknown()));
      const token = await this.session.cookie(TOKEN_COOKIE);
      return {
        ...base,
        loggedIn: true,
        tokenExpiresAt: token ? (jwtExpiry(token)?.toISOString() ?? null) : null,
        hasRefreshToken: !!(await this.session.cookie(REFRESH_COOKIE)),
      };
    } catch (err) {
      if (err instanceof SessionExpiredError) return { ...base, loggedIn: false, reason: 'session expired' };
      throw err;
    }
  }

  /** All enrolled courses from the portal, enriched with CFU/progress for the started ones. */
  async listCourses(): Promise<Course[]> {
    const courses = new Map<string, Course>();
    try {
      const res = await this.session.fetch(this.session.config.portalUrl);
      if (res.ok()) for (const c of parseCoursesFromPortal(await res.text())) courses.set(c.code, c);
      else this.log.warn(`portal answered HTTP ${res.status()}, using API courses only`);
    } catch (err) {
      this.log.warn('portal unreachable, using API courses only', err);
    }
    for (const c of await this.apiGet(API_PATHS.coursesInProgress, z.array(ApiCourse))) {
      courses.set(c.code, {
        code: c.code,
        title: c.title.trim(),
        cfu: c.cfu ?? courses.get(c.code)?.cfu ?? null,
        progress: c.progress === null || c.progress === undefined ? null : Math.round(c.progress),
        completed: c.completed ?? null,
      });
    }
    return [...courses.values()];
  }

  async listLessons(course: string): Promise<Lesson[]> {
    const code = assertCourseCode(course);
    const refs = await this.lessonRefs(code);
    return mapPool(refs, this.session.config.concurrency, (ref) => this.loadLesson(code, ref));
  }

  async getLesson(course: string, lessonNumber: number): Promise<Lesson> {
    const code = assertCourseCode(course);
    const ref = (await this.lessonRefs(code)).find((r) => r.display_order === lessonNumber);
    if (!ref) throw new NotFoundError(`Lesson ${lessonNumber} of course ${code}`);
    return this.loadLesson(code, ref);
  }

  async fetchFile(url: string): Promise<FetchedFile | null> {
    const res = await this.session.fetch(url, { headers: this.session.headersFor(url) });
    if (res.status() >= 400 && res.status() < 500) return null;
    if (!res.ok()) throw new HttpError(res.status(), url, '');
    return { body: await res.body(), contentType: res.headers()['content-type'] ?? '' };
  }

  private async loadLesson(code: string, ref: ApiLessonRef): Promise<Lesson> {
    return parseLesson(
      ref,
      await this.apiGet(API_PATHS.lessonItems(code, ref.lp_id), z.array(ApiLessonItem)),
    );
  }

  private lessonRefs(code: string): Promise<ApiLessonRef[]> {
    const hit = this.refCache.get(code);
    if (hit && Date.now() - hit.at < REF_CACHE_TTL_MS) return hit.refs;
    const refs = this.apiGet(API_PATHS.lessons(code), z.array(ApiLessonRef))
      .then((r) => [...r].sort((a, b) => a.display_order - b.display_order))
      .catch((err) => {
        this.refCache.delete(code);
        throw err;
      });
    this.refCache.set(code, { at: Date.now(), refs });
    return refs;
  }

  /** GET on the student API, validated against `schema`. Renews the JWT once on 401. */
  async apiGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    const url = API_BASE + path;
    for (let attempt = 0; ; attempt++) {
      const token = await this.session.cookie(TOKEN_COOKIE);
      const res = await this.session.fetch(url, {
        headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
      if (res.status() === 401) {
        if (attempt > 0) throw new SessionExpiredError();
        await this.refreshToken();
        continue;
      }
      if (res.status() === 404) throw new NotFoundError(path);
      if (!res.ok()) throw new HttpError(res.status(), path, await res.text().catch(() => ''));
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new PlatformChangedError(path, 'response is not JSON');
      }
      const parsed = ApiEnvelope(schema).safeParse(json);
      if (!parsed.success) throw new PlatformChangedError(path, z.prettifyError(parsed.error).slice(0, 400));
      return parsed.data.data as z.infer<T>;
    }
  }

  /** Single-flight: concurrent 401s share one renewal. The SPA renews the JWT when its home loads. */
  private refreshToken(): Promise<void> {
    this.refreshing ??= (async () => {
      this.log.info('JWT expired, renewing via the SPA');
      await this.session.withTempPage(async (page) => {
        await page.goto(SPA_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await settle(page, 1000);
      });
      await this.session.save();
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
}
