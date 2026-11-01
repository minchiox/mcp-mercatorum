import os from 'node:os';
import path from 'node:path';
import { type LogLevel, parseLogLevel } from './logger.js';
import { PORTAL_URL } from './platform.js';

export interface Config {
  /** Root folder for downloads: every file the tools write stays inside it. */
  workspace: string;
  /** Private folder (mode 700) for the session and optional debug captures. */
  dataDir: string;
  sessionFile: string;
  captureDir: string;
  portalUrl: string;
  headless: boolean;
  /** Playwright channel, e.g. "chrome" or "msedge", to use an installed browser instead of bundled Chromium. */
  browserChannel: string | undefined;
  extraAllowedHosts: string[];
  logLevel: LogLevel;
  /** Parallel HTTP requests for lesson listing and sync. */
  concurrency: number;
}

type Env = Record<string, string | undefined>;

/** Per-OS application data folder, following each platform's convention. */
export function defaultDataDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const app = 'mcp-mercatorum';
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), app);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', app);
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), app);
}

const truthy = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined || v === '' ? fallback : !/^(0|false|no|off)$/i.test(v);

export function loadConfig(env: Env = process.env, overrides: Partial<Config> = {}): Config {
  const dataDir = path.resolve(env.MERCATORUM_HOME || defaultDataDir(env));
  const concurrency = Number.parseInt(env.MERCATORUM_CONCURRENCY ?? '', 10);
  return {
    workspace: path.resolve(env.MERCATORUM_WORKSPACE || process.cwd()),
    dataDir,
    sessionFile: path.join(dataDir, 'session.json'),
    captureDir: path.join(dataDir, 'captures'),
    portalUrl: env.MERCATORUM_BASE_URL || PORTAL_URL,
    headless: truthy(env.MERCATORUM_HEADLESS, true),
    browserChannel: env.MERCATORUM_BROWSER_CHANNEL || undefined,
    extraAllowedHosts: (env.MERCATORUM_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    logLevel: parseLogLevel(env.MERCATORUM_LOG_LEVEL),
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? Math.min(concurrency, 16) : 4,
    ...overrides,
  };
}
