import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import type { BrowserTools, RawResponse } from '../src/core/browser-tools.js';
import { loadConfig } from '../src/core/config.js';
import { createServer } from '../src/mcp/server.js';
import { FakeClient, fixture, PDF, tmpDir } from './helpers.js';

const notUsed = async (): Promise<never> => {
  throw new Error('not used in this test');
};

function fakeBrowser(responses: Record<string, RawResponse> = {}): BrowserTools {
  return {
    openPage: notUsed,
    click: notUsed,
    downloadByClick: notUsed,
    get: async (url) => {
      const r = responses[url];
      if (!r) throw new Error(`unexpected GET ${url}`);
      return r;
    },
  };
}

async function connect(opts: { advancedTools?: boolean; responses?: Record<string, RawResponse> } = {}) {
  const workspace = tmpDir();
  const fake = new FakeClient();
  const config = loadConfig({ MERCATORUM_WORKSPACE: workspace, MERCATORUM_HOME: tmpDir() });
  const server = createServer({
    config,
    client: fake,
    browser: fakeBrowser(opts.responses),
    advancedTools: opts.advancedTools,
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const first = res.content[0];
    return { isError: !!res.isError, text: first?.type === 'text' ? first.text : '' };
  };
  return { client, call, workspace, fake };
}

describe('MCP server', () => {
  it('exposes study tools with read-only annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      'api_get',
      'click',
      'course_progress',
      'download',
      'download_by_click',
      'get_lesson',
      'get_transcript',
      'list_courses',
      'list_lessons',
      'open_page',
      'status',
      'sync_course',
    ]);
    for (const name of [
      'status',
      'list_courses',
      'list_lessons',
      'get_lesson',
      'get_transcript',
      'course_progress',
    ]) {
      expect(byName[name]?.annotations?.readOnlyHint, name).toBe(true);
    }
    expect(byName.sync_course?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('can hide the advanced tools', async () => {
    const { client } = await connect({ advancedTools: false });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('open_page');
    expect(names).toContain('get_transcript');
  });

  it('lists courses and compact lessons', async () => {
    const { call } = await connect();
    expect(JSON.parse((await call('list_courses')).text)[0].code).toBe('ABC123');
    const lessons = JSON.parse((await call('list_lessons', { course: 'ABC123' })).text);
    expect(lessons[0]).toEqual({
      number: 1,
      title: 'Lezione 1',
      teacher: 'Mario Rossi',
      progress: 100,
      handout: true,
      duration: '15:57',
      paragraphs: ['1. Cosa sono i dati? (10:57)', '2. Il ciclo di vita del dato (5:00)'],
    });
  });

  it('returns a transcript for one paragraph', async () => {
    const { call, fake } = await connect();
    const lesson = await fake.getLesson('ABC123', 1);
    fake.files[lesson.paragraphs[0]?.vttUrl as string] = {
      body: Buffer.from(fixture('sample.vtt')),
      contentType: 'text/vtt',
    };
    const { text, isError } = await call('get_transcript', { course: 'ABC123', lesson: 1, paragraph: 1 });
    expect(isError).toBe(false);
    expect(text).toContain('## 1.1 Cosa sono i dati?');
    expect(text).toContain('Buongiorno a tutti.');
    expect(text).not.toContain('1.2');
  });

  it('adds the platform link to watch a lesson', async () => {
    const { call } = await connect();
    expect(JSON.parse((await call('get_lesson', { course: 'ABC123', lesson: 2 })).text).watchUrl).toBe(
      'https://lms.mercatorum.multiversity.click/videolezioni/ABC123/2',
    );
  });

  it('reports errors as tool errors, with codes', async () => {
    const { call } = await connect();
    const r = await call('get_lesson', { course: 'ABC123', lesson: 99 });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toMatch(/^Error \[NOT_FOUND\]/);
    expect((await call('list_lessons', { course: '../../etc' })).text).toMatch(/NOT_FOUND/);
  });

  it('summarizes progress across courses', async () => {
    const { call } = await connect();
    const rows = JSON.parse((await call('course_progress')).text);
    expect(rows).toEqual([
      expect.objectContaining({
        code: 'ABC123',
        watchedLessons: '0/2',
        remaining: '5:00',
        selfTestsPending: 2,
      }),
    ]);
  });

  it('syncs a course inside the workspace and refuses folders outside it', async () => {
    const { call, workspace, fake } = await connect();
    const lesson = await fake.getLesson('ABC123', 1);
    fake.files[lesson.dispensaUrl as string] = { body: PDF, contentType: 'application/pdf' };

    const ok = await call('sync_course', { course: 'abc123', transcripts: false });
    expect(ok.isError).toBe(false);
    expect(JSON.parse(ok.text)).toMatchObject({ folder: 'Corso-di-prova', dispense: 1 });
    expect(fs.existsSync(path.join(workspace, 'Corso-di-prova', 'risorse', 'indice.md'))).toBe(true);

    const bad = await call('sync_course', { course: 'ABC123', folder: '../outside' });
    expect(bad.text).toMatch(/PATH_OUTSIDE_WORKSPACE/);
  });

  it('download refuses HTML pages pretending to be files', async () => {
    const url = 'https://d9t931z8aeptt.cloudfront.net/x.pdf';
    const { call, workspace } = await connect({
      responses: {
        [url]: { status: 200, contentType: 'text/html', body: Buffer.from('<html>login</html>') },
      },
    });
    expect((await call('download', { url, dest: 'x.pdf' })).text).toMatch(/NOT_A_FILE/);
    expect(fs.existsSync(path.join(workspace, 'x.pdf'))).toBe(false);
  });

  it('exposes study prompts', async () => {
    const { client } = await connect();
    const names = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    expect(names).toEqual(['piano_di_studio', 'simula_esame', 'studia_lezione']);
    const p = await client.getPrompt({
      name: 'studia_lezione',
      arguments: { course: 'ABC123', lesson: '3' },
    });
    expect(JSON.stringify(p.messages)).toContain('lezione 3 del corso ABC123');
  });
});
