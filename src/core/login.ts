import fs from 'node:fs';
import type { Config } from './config.js';
import { ensurePrivateDir, makePrivate } from './fs-safe.js';
import { type Logger, silentLogger } from './logger.js';
import { TOKEN_COOKIE } from './platform.js';
import { launchBrowser } from './session.js';

export interface LoginOptions {
  log?: Logger;
  /** Called once, when the platform's auth cookie first appears. */
  onLoggedIn?: () => void;
}

/**
 * Opens a visible browser on the portal: the student signs in by hand (credentials never touch this code),
 * the session is saved every few seconds and on every navigation, and the promise resolves when the window closes.
 */
export async function interactiveLogin(
  config: Config,
  opts: LoginOptions = {},
): Promise<{ loggedIn: boolean }> {
  const log = opts.log ?? silentLogger;
  ensurePrivateDir(config.dataDir);
  const browser = await launchBrowser(config, false);
  const context = await browser.newContext(
    fs.existsSync(config.sessionFile)
      ? { storageState: config.sessionFile, locale: 'it-IT' }
      : { locale: 'it-IT' },
  );
  const page = await context.newPage();
  let loggedIn = false;

  const save = async (): Promise<void> => {
    try {
      const hasToken = (await context.cookies()).some((c) => c.name === TOKEN_COOKIE);
      await context.storageState({ path: config.sessionFile });
      makePrivate(config.sessionFile);
      if (hasToken && !loggedIn) {
        loggedIn = true;
        opts.onLoggedIn?.();
      }
    } catch {
      /* context already closed */
    }
  };

  await page.goto(config.portalUrl).catch((err) => log.warn('could not open the portal', err));
  const timer = setInterval(save, 3000);
  page.on('framenavigated', () => void save());

  await new Promise<void>((resolve) => {
    page.once('close', () => resolve());
    browser.once('disconnected', () => resolve());
  });
  clearInterval(timer);
  await save();
  await browser.close().catch(() => {});
  return { loggedIn };
}
