import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserTools } from '../core/browser-tools.js';
import { assertCourseCode, type PlatformClient } from '../core/client.js';
import type { Config } from '../core/config.js';
import { formatError, MercatorumError, NotFoundError } from '../core/errors.js';
import { resolveInside, writeFileAtomic } from '../core/fs-safe.js';
import { type Logger, silentLogger } from '../core/logger.js';
import { formatDuration, isPdf, slugify } from '../core/parse.js';
import { watchUrl } from '../core/platform.js';
import { computeProgress } from '../core/progress.js';
import { syncCourse } from '../core/sync.js';
import { fetchTranscripts, renderLessonMarkdown } from '../core/transcript.js';
import { VERSION } from '../version.js';
import { registerPrompts } from './prompts.js';

export interface ServerDeps {
  config: Config;
  client: PlatformClient;
  browser: BrowserTools;
  /** Register open_page/click/api_get/download tools (default true). */
  advancedTools?: boolean;
  log?: Logger;
}

type Shape = z.ZodRawShape;

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
/** Writes local files only (never to the platform); re-running gives the same result. */
const WRITE_LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const text = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }] });
const json = (obj: unknown): CallToolResult => text(JSON.stringify(obj, null, 2));
const truncate = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max)}\n…[truncated: ${s.length} characters in total]` : s;

const courseArg = z.string().min(3).describe('Course code from list_courses, e.g. 0662509SECSS01');
const lessonArg = z.number().int().min(1).describe('Lesson number (as in list_lessons)');
const waitArg = z.number().int().min(0).max(30_000).optional().describe('Extra wait after load, ms');
const capturesArg = z
  .boolean()
  .default(false)
  .describe('Save full API response bodies to the private data folder (may contain personal data)');
const target = {
  text: z.string().optional().describe('Visible text of the element'),
  selector: z.string().optional().describe('CSS selector (alternative to text)'),
  nth: z.number().int().min(0).default(0).describe('Index when several elements match'),
};

export function createServer(deps: ServerDeps): McpServer {
  const { config, client, browser, advancedTools = true, log = silentLogger } = deps;
  const server = new McpServer(
    { name: 'mercatorum', title: 'Mercatorum study assistant', version: VERSION },
    {
      instructions:
        'Read-only access to the Universitas Mercatorum student platform: courses, lessons, transcripts, PDF handouts and ' +
        'viewing progress. Start with list_courses, then list_lessons / get_transcript. Use sync_course to download a ' +
        'whole course into the workspace. The server never records attendance or progress: lessons must be watched by ' +
        'the student on the platform.',
    },
  );

  const tool = <S extends Shape>(
    name: string,
    title: string,
    description: string,
    inputSchema: S,
    annotations: ToolAnnotations,
    handler: (args: z.infer<z.ZodObject<S>>, extra: ToolExtra) => Promise<CallToolResult>,
  ) =>
    server.registerTool(
      name,
      { title, description, inputSchema, annotations: { title, ...annotations } },
      // biome-ignore lint/suspicious/noExplicitAny: the SDK's callback type is generic over the schema
      (async (args: any, extra: ToolExtra) => {
        try {
          return await handler(args, extra);
        } catch (err) {
          log.warn(`tool ${name} failed`, err);
          const code = err instanceof MercatorumError ? ` [${err.code}]` : '';
          return { ...text(`Error${code}: ${formatError(err)}`), isError: true };
        }
      }) as never,
    );

  const workspacePath = (rel: string) => resolveInside(config.workspace, rel);
  const relToWorkspace = (abs: string) => path.relative(config.workspace, abs) || '.';

  // ---------------------------------------------------------------- study tools

  tool(
    'status',
    'Session status',
    'Check whether the saved platform session is valid and when the access token expires. Returns no personal data.',
    {},
    READ,
    async () => {
      const s = await client.status();
      return json({
        ...s,
        workspace: config.workspace,
        hint: s.loggedIn ? undefined : 'Run `mcp-mercatorum login`.',
      });
    },
  );

  tool(
    'list_courses',
    'List courses',
    "List the student's enrolled courses: code, title, CFU and progress (null if not started).",
    {},
    READ,
    async () => json(await client.listCourses()),
  );

  tool(
    'list_lessons',
    'List lessons',
    'List the lessons of a course with teacher, progress, video paragraphs and whether a PDF handout exists. ' +
      'Set compact=false for objectives and media URLs.',
    { course: courseArg, compact: z.boolean().default(true).describe('Omit objectives and URLs') },
    READ,
    async ({ course, compact }) => {
      const lessons = await client.listLessons(course);
      if (!compact) return json(lessons);
      return json(
        lessons.map((l) => ({
          number: l.number,
          title: l.title,
          teacher: l.teacher,
          progress: l.progress,
          handout: !!l.dispensaUrl,
          duration: formatDuration(l.paragraphs.reduce((s, p) => s + p.durationS, 0)),
          paragraphs: l.paragraphs.map((p) => `${p.number}. ${p.title} (${formatDuration(p.durationS)})`),
        })),
      );
    },
  );

  tool(
    'get_lesson',
    'Lesson details',
    'Full details of one lesson: objectives, teacher, paragraphs with duration and progress, handout URL, self-test, ' +
      'and watchUrl, the link to watch it on the platform.',
    { course: courseArg, lesson: lessonArg },
    READ,
    async ({ course, lesson }) => {
      const l = await client.getLesson(course, lesson);
      return json({ ...l, watchUrl: watchUrl(assertCourseCode(course), l.lpId) });
    },
  );

  tool(
    'get_transcript',
    'Lesson transcript',
    'Text of a lesson (from the video subtitles) as Markdown, with objectives and one section per paragraph. ' +
      'Use it to study, summarize or quiz on a lesson without downloading anything.',
    {
      course: courseArg,
      lesson: lessonArg,
      paragraph: z.number().int().min(1).optional().describe('Only this paragraph'),
      maxChars: z.number().int().min(1000).max(200_000).default(60_000),
    },
    READ,
    async ({ course, lesson, paragraph, maxChars }) => {
      const l = await client.getLesson(course, lesson);
      const selected = paragraph
        ? { ...l, paragraphs: l.paragraphs.filter((p) => p.number === paragraph) }
        : l;
      if (paragraph && !selected.paragraphs.length)
        throw new NotFoundError(`Paragraph ${paragraph} of lesson ${lesson}`);
      const texts = await fetchTranscripts(client, selected, config.concurrency);
      return text(truncate(renderLessonMarkdown(selected, texts), maxChars));
    },
  );

  tool(
    'course_progress',
    'Viewing progress',
    'What is left to watch (remaining video time, unfinished lessons and paragraphs) and which self-assessment ' +
      'tests are still open, from the progress reported by the platform. Without `course`, summarizes every ' +
      'started course. Informational only.',
    { course: courseArg.optional() },
    READ,
    async ({ course }) => {
      if (course) {
        const p = computeProgress(await client.listLessons(course));
        return json({
          ...p,
          total: formatDuration(p.totalS),
          remaining: formatDuration(p.remainingS),
          pending: p.pending.map((l) => ({
            ...l,
            remaining: formatDuration(l.remainingS),
            watchUrl: watchUrl(assertCourseCode(course), l.lpId),
          })),
        });
      }
      const started = (await client.listCourses()).filter((c) => c.progress !== null);
      const rows = [];
      for (const c of started) {
        const p = computeProgress(await client.listLessons(c.code));
        rows.push({
          code: c.code,
          title: c.title,
          cfu: c.cfu,
          platformProgress: c.progress,
          videoPercent: p.videoPercent,
          watchedLessons: `${p.watchedLessons}/${p.lessons}`,
          remaining: formatDuration(p.remainingS),
          selfTestsPending: p.selfTestsPending.length,
          nextToWatch: p.pending.slice(0, 3).map((l) => `${l.number}. ${l.title}`),
        });
      }
      return json(rows);
    },
  );

  tool(
    'sync_course',
    'Download course',
    'Download every PDF handout and lesson transcript of a course into <folder>/risorse/ inside the workspace, ' +
      'plus indice.md and corso.json. Existing files are kept unless force=true.',
    {
      course: courseArg,
      folder: z.string().optional().describe('Folder relative to the workspace; default: the course title'),
      transcripts: z.boolean().default(true).describe('Also build transcripts from subtitles'),
      force: z.boolean().default(false).describe('Download again files that already exist'),
    },
    WRITE_LOCAL,
    async ({ course, folder, transcripts, force }, extra) => {
      const code = assertCourseCode(course);
      const info = (await client.listCourses()).find((c) => c.code === code);
      if (!info) throw new NotFoundError(`Course ${code} among your enrolments`);
      const dir = workspacePath(folder ?? slugify(info.title));
      const progressToken = extra._meta?.progressToken;
      const report = await syncCourse(client, {
        course: code,
        title: info.title,
        dir,
        force,
        transcripts,
        concurrency: config.concurrency,
        onProgress: (progress, total, message) => {
          if (progressToken === undefined) return;
          void extra
            .sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress, total, message },
            })
            .catch(() => {});
        },
      });
      return json({ folder: relToWorkspace(dir), ...report });
    },
  );

  if (!advancedTools) {
    registerPrompts(server);
    return server;
  }

  // ---------------------------------------------------------------- advanced tools (discovery)

  tool(
    'open_page',
    'Open page',
    'Advanced: open a platform URL with the student session and return its text, links, iframes and the JSON API ' +
      'calls it made. Tracking requests are blocked and listed in blockedRequests.',
    {
      url: z.url().optional().describe('Default: the portal home'),
      waitMs: waitArg,
      saveCaptures: capturesArg,
    },
    READ,
    async ({ url, waitMs, saveCaptures }) =>
      json(await browser.openPage(url ?? config.portalUrl, { waitMs, saveCaptures })),
  );

  tool(
    'click',
    'Click element',
    'Advanced: click an element of the page opened with open_page (by visible text or CSS selector) and return the ' +
      'new snapshot. Useful to expand sections of the web app.',
    { ...target, waitMs: waitArg, saveCaptures: capturesArg },
    { readOnlyHint: true, openWorldHint: true },
    async ({ text: t, selector, nth, waitMs, saveCaptures }) =>
      json(await browser.click({ text: t, selector, nth }, { waitMs, saveCaptures })),
  );

  tool(
    'api_get',
    'API GET',
    'Advanced: GET a platform endpoint (discovered with open_page) with the session cookies and auth headers. ' +
      'Optionally save the body to a file in the workspace.',
    {
      url: z.url(),
      saveTo: z.string().optional().describe('File path relative to the workspace'),
      maxChars: z.number().int().min(100).max(200_000).default(20_000),
    },
    READ,
    async ({ url, saveTo, maxChars }) => {
      const res = await browser.get(url);
      const body = res.body.toString('utf8');
      if (saveTo) writeFileAtomic(workspacePath(saveTo), res.body);
      return json({
        status: res.status,
        contentType: res.contentType,
        savedTo: saveTo ?? null,
        body: truncate(body, maxChars),
      });
    },
  );

  tool(
    'download',
    'Download file',
    'Download a file (PDF, slides…) from a direct platform URL with the student session into the workspace.',
    {
      url: z.url(),
      dest: z.string().describe('File path relative to the workspace, e.g. "Course/risorse/notes.pdf"'),
    },
    WRITE_LOCAL,
    async ({ url, dest }) => {
      const out = workspacePath(dest);
      const res = await browser.get(url);
      if (res.status >= 400) throw new MercatorumError(`HTTP ${res.status} on ${url}`, 'HTTP_ERROR');
      const htmlInsteadOfFile = res.contentType.includes('text/html') && !/\.html?$/i.test(out);
      if (htmlInsteadOfFile && !isPdf(res.body)) {
        throw new MercatorumError(
          'The server returned an HTML page instead of a file (expired session or not a direct link).',
          'NOT_A_FILE',
        );
      }
      writeFileAtomic(out, res.body);
      return json({ savedTo: relToWorkspace(out), bytes: res.body.length, contentType: res.contentType });
    },
  );

  tool(
    'download_by_click',
    'Download by click',
    'Download a file started by clicking an element of the current page (download buttons without a direct link).',
    { ...target, destDir: z.string().describe('Folder relative to the workspace') },
    WRITE_LOCAL,
    async ({ text: t, selector, nth, destDir }) => {
      const dir = workspacePath(destDir);
      fs.mkdirSync(dir, { recursive: true });
      const { file, sourceUrl } = await browser.downloadByClick({ text: t, selector, nth }, dir);
      return json({ savedTo: relToWorkspace(file), sourceUrl });
    },
  );

  registerPrompts(server);
  return server;
}

/** The subset of the SDK's request-handler extra we use. */
interface ToolExtra {
  _meta?: { progressToken?: string | number };
  sendNotification: (n: {
    method: 'notifications/progress';
    params: { progressToken: string | number; progress: number; total: number; message: string };
  }) => Promise<void>;
}
