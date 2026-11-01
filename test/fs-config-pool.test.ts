import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultDataDir, loadConfig } from '../src/core/config.js';
import { PathOutsideWorkspaceError } from '../src/core/errors.js';
import { resolveInside, writeFileAtomic } from '../src/core/fs-safe.js';
import { mapPool, sleep } from '../src/core/pool.js';
import { tmpDir } from './helpers.js';

describe('resolveInside', () => {
  const root = tmpDir();

  it('resolves relative paths inside the root', () => {
    expect(resolveInside(root, 'Corso/risorse/a.pdf')).toBe(path.join(root, 'Corso', 'risorse', 'a.pdf'));
    expect(resolveInside(root, '.')).toBe(root);
  });

  it.each(['..', '../x', 'a/../../x', '/etc/passwd'])('rejects %s', (rel) => {
    expect(() => resolveInside(root, rel)).toThrow(PathOutsideWorkspaceError);
  });

  it('rejects symlinks that escape the root', () => {
    const outside = tmpDir();
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction'); // junction: no admin rights needed on Windows
    expect(() => resolveInside(root, 'link/file.txt')).toThrow(PathOutsideWorkspaceError);
  });
});

describe('writeFileAtomic', () => {
  it('creates folders, writes the content and leaves no temp files', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'a', 'b', 'c.txt');
    writeFileAtomic(file, 'hello');
    writeFileAtomic(file, 'world');
    expect(fs.readFileSync(file, 'utf8')).toBe('world');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['c.txt']);
  });
});

describe('config', () => {
  it('uses each OS convention for the data folder', () => {
    expect(defaultDataDir({}, 'linux', '/home/u')).toBe(path.join('/home/u', '.config', 'mcp-mercatorum'));
    expect(defaultDataDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/u')).toBe(
      path.join('/x', 'mcp-mercatorum'),
    );
    expect(defaultDataDir({}, 'darwin', '/Users/u')).toBe(
      path.join('/Users/u', 'Library', 'Application Support', 'mcp-mercatorum'),
    );
    expect(defaultDataDir({ APPDATA: 'C:\\AppData' }, 'win32', 'C:\\u')).toContain('mcp-mercatorum');
  });

  it('reads environment overrides', () => {
    const c = loadConfig({
      MERCATORUM_WORKSPACE: '/ws',
      MERCATORUM_HOME: '/data',
      MERCATORUM_HEADLESS: 'false',
      MERCATORUM_ALLOWED_HOSTS: ' A.example.org, ,b.org ',
      MERCATORUM_CONCURRENCY: '99',
      MERCATORUM_LOG_LEVEL: 'debug',
    });
    expect(c).toMatchObject({
      workspace: path.resolve('/ws'),
      sessionFile: path.resolve('/data', 'session.json'),
      captureDir: path.resolve('/data', 'captures'),
      headless: false,
      extraAllowedHosts: ['a.example.org', 'b.org'],
      concurrency: 16,
      logLevel: 'debug',
    });
  });

  it('has safe defaults', () => {
    const c = loadConfig({
      MERCATORUM_HOME: '/data',
      MERCATORUM_CONCURRENCY: 'abc',
      MERCATORUM_LOG_LEVEL: 'loud',
    });
    expect(c).toMatchObject({ headless: true, concurrency: 4, logLevel: 'info', extraAllowedHosts: [] });
    expect(c.workspace).toBe(process.cwd());
  });
});

describe('mapPool', () => {
  it('preserves order and respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([30, 10, 20, 5, 15], 2, async (ms, i) => {
      peak = Math.max(peak, ++inFlight);
      await sleep(ms);
      inFlight--;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it('handles empty input', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
