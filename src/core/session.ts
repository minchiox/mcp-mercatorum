import fs from 'node:fs';
import {
  type APIResponse,
  type Browser,
  type BrowserContext,
  chromium,
  type LaunchOptions,
  type Page,
} from 'playwright';
import type { Config } from './config.js';
import { BlockedRequestError, BrowserNotInstalledError, NotLoggedInError } from './errors.js';
import { ensurePrivateDir, makePrivate } from './fs-safe.js';
import { classifyRequest } from './guard.js';
import { type Logger, silentLogger } from './logger.js';
import { API_HOST, TRACKING_PATH_RE } from './platform.js';
import { sleep } from './pool.js';

export interface CapturedCall {
  method: string;
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  body: string;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: string;
  timeoutMs?: number;
  retries?: number;
}

const AUTH_HEADER_RE = /^(authorization|x-.*(token|auth|csrf).*)$/i;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_CAPTURED = 100;
const MAX_BODY = 200_000;

export async function settle(page: Page, waitMs = 1500): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (waitMs > 0) await page.waitForTimeout(waitMs);
}

export function launchOptions(config: Config, headless: boolean): LaunchOptions {
  return { headless, ...(config.browserChannel ? { channel: config.browserChannel } : {}) };
}

export async function launchBrowser(config: Config, headless = config.headless): Promise<Browser> {
  try {
    return await chromium.launch(launchOptions(config, headless));
  } catch (err) {
    if (err instanceof Error && /Executable doesn't exist|browserType\.launch.*install/is.test(err.message)) {
      throw new BrowserNotInstalledError();
    }
    throw err;
  }
}

/**
 * One headless browser context loaded with the student's saved session, shared by all tools.
 * Every request goes through the read-only guard: in the browser via routing, for direct calls via `fetch`.
 */
export class BrowserSession {
  private browserP: Promise<Browser> | undefined;
  private ctxP: Promise<BrowserContext> | undefined;
  private pageP: Promise<Page> | undefined;
  private stateMtime = 0;
  private readonly authHeaders = new Map<string, Record<string, string>>();
  private calls: CapturedCall[] = [];
  private blocked: string[] = [];

  constructor(
    readonly config: Config,
    private readonly log: Logger = silentLogger,
  ) {}

  hasSession(): boolean {
    return fs.existsSync(this.config.sessionFile);
  }

  /** Shared context; transparently reloaded when `login` wrote a new session file. */
  context(): Promise<BrowserContext> {
    if (!this.hasSession()) return Promise.reject(new NotLoggedInError());
    const mtime = fs.statSync(this.config.sessionFile).mtimeMs;
    if (this.ctxP && mtime !== this.stateMtime) {
      this.log.info('session file changed, reloading browser context');
      const stale = this.ctxP;
      this.ctxP = this.pageP = undefined;
      void stale.then((c) => c.close()).catch(() => {});
    }
    if (!this.ctxP) {
      this.stateMtime = mtime;
      this.ctxP = this.createContext().catch((err) => {
        this.ctxP = undefined;
        throw err;
      });
    }
    return this.ctxP;
  }

  /** The shared page used by the browsing tools (open_page, click…). */
  async page(): Promise<Page> {
    const ctx = await this.context();
    const current = this.pageP && (await this.pageP.catch(() => undefined));
    if (current && !current.isClosed()) return current;
    this.pageP = ctx.newPage();
    return this.pageP;
  }

  /** Runs `fn` on a throwaway page, so background work never navigates the shared one. */
  async withTempPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const page = await (await this.context()).newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Persists refreshed cookies (e.g. a renewed JWT) without triggering a context reload. */
  async save(): Promise<void> {
    const ctx = await this.context();
    ensurePrivateDir(this.config.dataDir);
    await ctx.storageState({ path: this.config.sessionFile });
    makePrivate(this.config.sessionFile);
    this.stateMtime = fs.statSync(this.config.sessionFile).mtimeMs;
  }

  async cookie(name: string): Promise<string | null> {
    const c = (await (await this.context()).cookies()).find((x) => x.name === name);
    return c ? decodeURIComponent(c.value) : null;
  }

  /** Auth headers the site itself sent to this host (e.g. bearer tokens set by the SPA). */
  headersFor(url: string): Record<string, string> {
    return this.authHeaders.get(new URL(url).host) ?? {};
  }

  /** Direct HTTP call with the session cookies. Guarded, with timeout and retries for idempotent methods. */
  async fetch(url: string, opts: FetchOptions = {}): Promise<APIResponse> {
    const method = (opts.method ?? 'GET').toUpperCase();
    const verdict = classifyRequest(method, url);
    if (!verdict.allow) {
      this.recordBlocked(method, url);
      throw new BlockedRequestError(method, url, verdict.reason);
    }
    const ctx = await this.context();
    const retries = method === 'GET' || method === 'HEAD' ? (opts.retries ?? 2) : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await ctx.request.fetch(url, {
          method,
          headers: opts.headers,
          data: opts.data,
          timeout: opts.timeoutMs ?? 30_000,
          failOnStatusCode: false,
        });
        if (RETRYABLE_STATUS.has(res.status()) && attempt < retries) {
          this.log.debug(`retrying ${method} ${url} after HTTP ${res.status()}`);
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= retries) throw err;
        this.log.debug(`retrying ${method} ${url} after error`, err);
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  /** API calls observed in the browser and blocked requests since the last drain. */
  drainActivity(): { calls: CapturedCall[]; blocked: string[] } {
    const out = { calls: this.calls, blocked: this.blocked };
    this.calls = [];
    this.blocked = [];
    return out;
  }

  async close(): Promise<void> {
    const browser = this.browserP;
    this.browserP = this.ctxP = this.pageP = undefined;
    if (browser) await (await browser.catch(() => undefined))?.close().catch(() => {});
  }

  private recordBlocked(method: string, url: string): void {
    this.log.info(`blocked ${method} ${url}`);
    this.blocked.push(`${method} ${url}`);
  }

  private async createContext(): Promise<BrowserContext> {
    this.browserP ??= launchBrowser(this.config).catch((err) => {
      this.browserP = undefined;
      throw err;
    });
    const browser = await this.browserP;
    const ctx = await browser.newContext({
      storageState: this.config.sessionFile,
      acceptDownloads: true,
      locale: 'it-IT',
      // Service workers can issue requests that bypass routing: block them to keep the guard airtight.
      serviceWorkers: 'block',
    });

    await ctx.route(
      (url) => url.host === API_HOST || TRACKING_PATH_RE.test(url.pathname),
      async (route) => {
        const req = route.request();
        if (classifyRequest(req.method(), req.url()).allow) return route.continue();
        this.recordBlocked(req.method(), req.url());
        return route.abort('blockedbyclient');
      },
    );

    ctx.on('request', (req) => {
      const headers = Object.fromEntries(
        Object.entries(req.headers()).filter(([k]) => AUTH_HEADER_RE.test(k)),
      );
      if (Object.keys(headers).length) {
        const host = new URL(req.url()).host;
        this.authHeaders.set(host, { ...this.authHeaders.get(host), ...headers });
      }
    });

    ctx.on('response', async (res) => {
      const type = res.request().resourceType();
      const contentType = res.headers()['content-type'] ?? '';
      if (!['xhr', 'fetch'].includes(type) && !contentType.includes('json')) return;
      try {
        const body = await res.text();
        this.calls.push({
          method: res.request().method(),
          url: res.url(),
          status: res.status(),
          contentType,
          bytes: body.length,
          body: body.slice(0, MAX_BODY),
        });
        if (this.calls.length > MAX_CAPTURED) this.calls.shift();
      } catch {
        /* body unavailable (redirect, aborted) */
      }
    });

    return ctx;
  }
}
