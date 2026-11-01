#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PlaywrightBrowserTools } from './core/browser-tools.js';
import { assertCourseCode, MercatorumClient } from './core/client.js';
import { type Config, loadConfig } from './core/config.js';
import { formatError, NotFoundError } from './core/errors.js';
import { resolveInside } from './core/fs-safe.js';
import { createLogger, type Logger } from './core/logger.js';
import { interactiveLogin } from './core/login.js';
import { formatDuration, slugify } from './core/parse.js';
import { watchUrl } from './core/platform.js';
import { computeProgress } from './core/progress.js';
import { BrowserSession } from './core/session.js';
import { syncCourse } from './core/sync.js';
import { createServer } from './mcp/server.js';
import { VERSION } from './version.js';

const HELP = `mcp-mercatorum ${VERSION} — read-only AI study assistant for Universitas Mercatorum

Usage:
  mcp-mercatorum [serve]              Start the MCP server on stdio (what MCP clients run)
  mcp-mercatorum login                Sign in in a browser window and save the session
  mcp-mercatorum logout               Delete the saved session
  mcp-mercatorum status               Check the saved session
  mcp-mercatorum courses              List your courses
  mcp-mercatorum progress [CODE]      What is left to watch
  mcp-mercatorum sync CODE [options]  Download handouts and transcripts of a course

Sync options:
  --dir <path>        Folder relative to the workspace (default: course title)
  --no-transcripts    Only PDF handouts
  --force             Download again existing files

Global options:
  --workspace <path>  Download root (env MERCATORUM_WORKSPACE, default: current folder)
  -h, --help          Show this help
  -v, --version       Show the version

Docs: https://github.com/minchiox/mcp-mercatorum`;

const out = (s: string) => process.stdout.write(`${s}\n`);
// `mcp-mercatorum courses | head` closes stdout early: that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
      'no-transcripts': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) {
    out(HELP);
    return 0;
  }
  if (values.version) {
    out(VERSION);
    return 0;
  }

  const config = loadConfig(
    process.env,
    values.workspace ? { workspace: path.resolve(values.workspace) } : {},
  );
  const log = createLogger(config.logLevel);
  const [command = 'serve', arg] = positionals;

  switch (command) {
    case 'serve':
      return serve(config, log);
    case 'login':
      return login(config, log);
    case 'logout':
      fs.rmSync(config.sessionFile, { force: true });
      out(`Session deleted (${config.sessionFile}).`);
      return 0;
  }

  const session = new BrowserSession(config, log);
  const client = new MercatorumClient(session, log);
  try {
    switch (command) {
      case 'status': {
        const s = await client.status();
        out(
          s.loggedIn
            ? `Logged in. Token expires: ${s.tokenExpiresAt ?? 'unknown'}`
            : `Not logged in (${s.reason}).`,
        );
        out(`Session file: ${s.sessionFile}`);
        return s.loggedIn ? 0 : 1;
      }
      case 'courses': {
        for (const c of await client.listCourses()) {
          const prog = c.progress === null ? '  —' : `${String(c.progress).padStart(3)}%`;
          out(`${c.code.padEnd(16)} ${prog}  ${c.cfu ? `${c.cfu} CFU  ` : ''}${c.title}`);
        }
        return 0;
      }
      case 'progress': {
        const courses = arg
          ? [{ code: assertCourseCode(arg), title: arg, progress: null as number | null }]
          : (await client.listCourses()).filter((c) => c.progress !== null);
        for (const c of courses) {
          const p = computeProgress(await client.listLessons(c.code));
          const platform = c.progress === null ? '' : `platform ${c.progress}% · `;
          out(`\n${c.title} (${c.code})`);
          out(
            `  ${platform}videos ${p.videoPercent}% watched (${p.watchedLessons}/${p.lessons} lessons), ` +
              `${formatDuration(p.remainingS)} left · self-tests to do: ${p.selfTestsPending.length}`,
          );
          for (const l of p.pending.slice(0, arg ? undefined : 5)) {
            out(`  ${String(l.number).padStart(2)}. ${l.title} — ${formatDuration(l.remainingS)} left`);
            out(`      ${watchUrl(c.code, l.lpId)}`);
          }
        }
        return 0;
      }
      case 'sync': {
        if (!arg) throw new Error('Usage: mcp-mercatorum sync CODE');
        const code = assertCourseCode(arg);
        const info = (await client.listCourses()).find((c) => c.code === code);
        if (!info) throw new NotFoundError(`Course ${code} among your enrolments`);
        const dir = resolveInside(config.workspace, values.dir ?? slugify(info.title));
        out(`Syncing "${info.title}" into ${dir}`);
        const report = await syncCourse(client, {
          course: code,
          title: info.title,
          dir,
          force: values.force,
          transcripts: !values['no-transcripts'],
          concurrency: config.concurrency,
          onProgress: (done, total, msg) =>
            process.stderr.write(`\r[${done}/${total}] ${msg.slice(0, 70).padEnd(70)}`),
        });
        process.stderr.write('\n');
        out(JSON.stringify(report, null, 2));
        return report.errors.length ? 1 : 0;
      }
      default:
        out(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } finally {
    await session.close();
  }
}

async function serve(config: Config, log: Logger): Promise<number> {
  const session = new BrowserSession(config, log);
  const client = new MercatorumClient(session, log);
  const server = createServer({
    config,
    client,
    browser: new PlaywrightBrowserTools(session),
    advancedTools: process.env.MERCATORUM_TOOLS !== 'core',
    log,
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => {});
    await session.close();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  log.info(`MCP server ${VERSION} ready (workspace: ${config.workspace})`);
  if (!session.hasSession()) log.warn('no saved session: run `mcp-mercatorum login`');
  return new Promise(() => {}); // runs until stdin closes
}

async function login(config: Config, log: Logger): Promise<number> {
  out('A browser window is opening: sign in to the platform, then close the window.');
  out('Your password is typed into the official site only; this tool never sees it.');
  const { loggedIn } = await interactiveLogin(config, {
    log,
    onLoggedIn: () => out('Login detected — session saved. You can close the window.'),
  });
  out(loggedIn ? `Session saved to ${config.sessionFile}` : 'Window closed before the login completed.');
  return loggedIn ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`Error: ${formatError(err)}`);
    process.exitCode = 1;
  },
);
