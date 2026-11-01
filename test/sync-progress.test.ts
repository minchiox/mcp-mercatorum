import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeProgress } from '../src/core/progress.js';
import { syncCourse } from '../src/core/sync.js';
import { renderLessonMarkdown } from '../src/core/transcript.js';
import { FakeClient, fixture, makeLesson, PDF, tmpDir } from './helpers.js';

const VTT = Buffer.from(fixture('sample.vtt'));

/** Two lessons sharing one handout, both with two paragraphs; only the first paragraph has subtitles. */
function setup() {
  const l1 = makeLesson(1, { title: 'Intro: dati/informazione?' });
  const l2 = makeLesson(2, { title: 'Seconda' });
  const files = {
    [l1.dispensaUrl as string]: { body: PDF, contentType: 'application/pdf' },
    [l1.paragraphs[0]?.vttUrl as string]: { body: VTT, contentType: 'text/vtt' },
  };
  return { client: new FakeClient(undefined, { ABC123: [l1, l2] }, files), l1, l2 };
}

describe('syncCourse', () => {
  it('downloads a shared handout once, writes transcripts, index and metadata', async () => {
    const { client } = setup();
    const dir = tmpDir();
    const progress: number[] = [];
    const report = await syncCourse(client, {
      course: 'ABC123',
      title: 'Corso di prova',
      dir,
      onProgress: (done) => progress.push(done),
    });

    expect(report).toMatchObject({ lessons: 2, dispense: 1, transcripts: 2, skipped: 0, errors: [] });
    expect(report.missing).toEqual(['trascrizione 1.2', 'trascrizione 2.2']);
    expect(progress.sort()).toEqual([1, 2]);

    const res = path.join(dir, 'risorse');
    expect(fs.readdirSync(path.join(res, 'dispense'))).toEqual(['01 - Intro datiinformazione.pdf']);
    expect(fs.readdirSync(path.join(res, 'trascrizioni')).sort()).toEqual([
      '01 - Intro datiinformazione.md',
      '02 - Seconda.md',
    ]);
    const transcript = fs.readFileSync(path.join(res, 'trascrizioni', '02 - Seconda.md'), 'utf8');
    expect(transcript).toContain('Buongiorno a tutti.');
    expect(transcript).toContain('_Trascrizione non disponibile._');

    const index = fs.readFileSync(path.join(res, 'indice.md'), 'utf8');
    // both lessons link the same PDF; links are relative to risorse/ and URL-encoded
    expect(index.match(/\[PDF\]\(dispense\/01%20-%20Intro%20dati/g)).toHaveLength(2);
    const meta = JSON.parse(fs.readFileSync(path.join(res, 'corso.json'), 'utf8'));
    expect(meta.lessons[1].dispensaFile).toBe(path.join('dispense', '01 - Intro datiinformazione.pdf'));
  });

  it('is idempotent and honours force', async () => {
    const { client } = setup();
    const dir = tmpDir();
    await syncCourse(client, { course: 'ABC123', title: 'T', dir });
    const before = client.fetched.length;

    const again = await syncCourse(client, { course: 'ABC123', title: 'T', dir });
    expect(again).toMatchObject({ dispense: 0, transcripts: 0, skipped: 3 });
    expect(client.fetched.length).toBe(before);

    const forced = await syncCourse(client, { course: 'ABC123', title: 'T', dir, force: true });
    expect(forced).toMatchObject({ dispense: 1, transcripts: 2, skipped: 0 });
  });

  it('rejects non-PDF handouts and isolates per-lesson failures', async () => {
    const l1 = makeLesson(1);
    const l2 = makeLesson(2, { dispensaUrl: 'https://d9t931z8aeptt.cloudfront.net/other.pdf' });
    const client = new FakeClient(
      undefined,
      { ABC123: [l1, l2] },
      {
        [l1.dispensaUrl as string]: {
          body: Buffer.from('<html>login</html>'),
          contentType: 'application/pdf',
        },
      },
    );
    client.fetchFile = async (url) => {
      if (url.endsWith('other.pdf')) throw new Error('network down');
      return url === l1.dispensaUrl ? { body: Buffer.from('<html>'), contentType: 'application/pdf' } : null;
    };
    const report = await syncCourse(client, {
      course: 'ABC123',
      title: 'T',
      dir: tmpDir(),
      transcripts: false,
    });
    expect(report.dispense).toBe(0);
    expect(report.missing).toEqual(['dispensa lezione 1']);
    expect(report.errors).toEqual(['lezione 2: network down']);
  });
});

describe('computeProgress', () => {
  it('weights by duration and lists what is left', () => {
    const done = makeLesson(1, { progress: 100 });
    const partial = makeLesson(2, { progress: 60 }); // fixture: 657 s at 100 %, 300 s at 50 %
    for (const p of done.paragraphs) p.progress = 100;
    const p = computeProgress([done, partial]);
    expect(p).toMatchObject({
      lessons: 2,
      watchedLessons: 1,
      totalS: 1914,
      remainingS: 150,
      videoPercent: 92,
    });
    expect(p.selfTestsPending).toEqual([1, 2]); // fixture self-test is at 0 %
    expect(p.pending).toEqual([
      expect.objectContaining({
        number: 2,
        remainingS: 150,
        pendingParagraphs: ['2. Il ciclo di vita del dato'],
        selfTestDone: false,
      }),
    ]);
  });

  it('does not count lessons whose videos are watched but whose self-test is open as pending', () => {
    const l = makeLesson(1, { progress: 80 });
    for (const p of l.paragraphs) p.progress = 100;
    expect(computeProgress([l])).toMatchObject({
      watchedLessons: 1,
      remainingS: 0,
      pending: [],
      selfTestsPending: [1],
    });
  });

  it('handles an empty course', () => {
    expect(computeProgress([])).toMatchObject({
      lessons: 0,
      videoPercent: 0,
      pending: [],
      selfTestsPending: [],
    });
  });
});

describe('renderLessonMarkdown', () => {
  it('renders objectives and one section per paragraph', () => {
    const md = renderLessonMarkdown(makeLesson(3), ['Testo uno.', null]);
    expect(md).toMatch(/^# Lezione 3 — Lezione 3\n\nDocente: Mario Rossi\n\n## Obiettivi/);
    expect(md).toContain('## 3.1 Cosa sono i dati? (10:57)\n\nTesto uno.');
    expect(md).toContain('## 3.2 Il ciclo di vita del dato (5:00)\n\n_Trascrizione non disponibile._');
  });
});
