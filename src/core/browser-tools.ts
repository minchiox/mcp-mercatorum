import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { ensurePrivateDir, writeFileAtomic } from './fs-safe.js';
import { assertHostAllowed } from './guard.js';
import { type BrowserSession, settle } from './session.js';

export interface PageSnapshot {
  url: string;
  title: string;
  loginRequired: boolean;
  text: string;
  links: { text: string; href: string }[];
  iframes: string[];
  /** "METHOD STATUS URL (N B)" for every XHR/JSON response seen. */
  apiCalls: string[];
  /** Requests stopped by the read-only guard (e.g. attendance tracking). */
  blockedRequests: string[];
  /** Full response bodies, only when requested: they may contain personal data. */
  captureFile: string | null;
}

export interface SnapshotOptions {
  waitMs?: number;
  maxText?: number;
  maxLinks?: number;
  saveCaptures?: boolean;
}

export interface ClickTarget {
  text?: string;
  selector?: string;
  nth?: number;
}

export interface RawResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

/** Low-level browsing used by the "advanced" MCP tools to explore pages the typed API does not cover. */
export interface BrowserTools {
  openPage(url: string, opts?: SnapshotOptions): Promise<PageSnapshot>;
  click(target: ClickTarget, opts?: SnapshotOptions): Promise<PageSnapshot>;
  downloadByClick(target: ClickTarget, destDir: string): Promise<{ file: string; sourceUrl: string }>;
  get(url: string): Promise<RawResponse>;
}

export class PlaywrightBrowserTools implements BrowserTools {
  constructor(private readonly session: BrowserSession) {}

  private get extraHosts(): string[] {
    return this.session.config.extraAllowedHosts;
  }

  async openPage(url: string, opts: SnapshotOptions = {}): Promise<PageSnapshot> {
    assertHostAllowed(url, this.extraHosts);
    const page = await this.session.page();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page, opts.waitMs);
    return this.snapshot(page, opts);
  }

  async click(target: ClickTarget, opts: SnapshotOptions = {}): Promise<PageSnapshot> {
    const page = await this.session.page();
    await this.locate(page, target).click({ timeout: 10_000 });
    await settle(page, opts.waitMs);
    return this.snapshot(page, opts);
  }

  async downloadByClick(target: ClickTarget, destDir: string): Promise<{ file: string; sourceUrl: string }> {
    const page = await this.session.page();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      this.locate(page, target).click({ timeout: 10_000 }),
    ]);
    assertHostAllowed(download.url(), this.extraHosts);
    const file = path.join(destDir, path.basename(download.suggestedFilename()) || 'download');
    await download.saveAs(file);
    return { file, sourceUrl: download.url() };
  }

  async get(url: string): Promise<RawResponse> {
    assertHostAllowed(url, this.extraHosts);
    const res = await this.session.fetch(url, { headers: this.session.headersFor(url) });
    return { status: res.status(), contentType: res.headers()['content-type'] ?? '', body: await res.body() };
  }

  private locate(page: Page, { text, selector, nth = 0 }: ClickTarget): Locator {
    if (!text && !selector) throw new Error('Either `text` or `selector` is required.');
    return (selector ? page.locator(selector) : page.getByText(text as string, { exact: false })).nth(nth);
  }

  private async snapshot(page: Page, opts: SnapshotOptions): Promise<PageSnapshot> {
    const { maxText = 15_000, maxLinks = 200, saveCaptures = false } = opts;
    const data = await page.evaluate((max) => {
      const links = [...document.querySelectorAll('a[href]')]
        .map((a) => ({
          text: (a as HTMLElement).innerText.trim().replace(/\s+/g, ' ').slice(0, 120),
          href: (a as HTMLAnchorElement).href,
        }))
        .filter((l) => l.href.startsWith('http'))
        .slice(0, max);
      return {
        title: document.title,
        text: document.body?.innerText ?? '',
        hasPasswordField: !!document.querySelector('input[type="password"]'),
        links,
        frames: [...document.querySelectorAll('iframe[src]')].map((f) => (f as HTMLIFrameElement).src),
      };
    }, maxLinks);

    const { calls, blocked } = this.session.drainActivity();
    let captureFile: string | null = null;
    if (saveCaptures && calls.length) {
      const dir = this.session.config.captureDir;
      ensurePrivateDir(dir);
      captureFile = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileAtomic(captureFile, JSON.stringify(calls, null, 2), 0o600);
    }

    return {
      url: page.url(),
      title: data.title,
      loginRequired: data.hasPasswordField,
      text: data.text.length > maxText ? `${data.text.slice(0, maxText)}\n…[truncated]` : data.text,
      links: data.links,
      iframes: data.frames,
      apiCalls: calls.map((c) => `${c.method} ${c.status} ${c.url} (${c.bytes} B)`),
      blockedRequests: blocked,
      captureFile,
    };
  }
}
