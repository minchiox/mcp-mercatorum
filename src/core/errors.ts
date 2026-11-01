/** Base class: every error this package throws on purpose carries a stable `code`. */
export class MercatorumError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotLoggedInError extends MercatorumError {
  constructor() {
    super(
      'No saved session.',
      'NOT_LOGGED_IN',
      'Run `mcp-mercatorum login` and sign in in the browser window.',
    );
  }
}

export class SessionExpiredError extends MercatorumError {
  constructor() {
    super(
      'The session has expired and could not be renewed.',
      'SESSION_EXPIRED',
      'Run `mcp-mercatorum login` again.',
    );
  }
}

/** Raised by the guard: the request would write to the platform (e.g. attendance tracking). */
export class BlockedRequestError extends MercatorumError {
  constructor(method: string, url: string, reason: string) {
    super(`Blocked ${method} ${url}: ${reason}`, 'REQUEST_BLOCKED');
  }
}

export class HostNotAllowedError extends MercatorumError {
  constructor(url: string) {
    super(
      `Host not allowed: ${url}`,
      'HOST_NOT_ALLOWED',
      'Only Mercatorum platform hosts are reachable. Extend with MERCATORUM_ALLOWED_HOSTS if needed.',
    );
  }
}

export class PathOutsideWorkspaceError extends MercatorumError {
  constructor(rel: string) {
    super(`Path is outside the workspace: ${rel}`, 'PATH_OUTSIDE_WORKSPACE');
  }
}

export class BrowserNotInstalledError extends MercatorumError {
  constructor() {
    super(
      'Chromium for Playwright is not installed.',
      'BROWSER_NOT_INSTALLED',
      'Run `npx playwright install chromium`, or set MERCATORUM_BROWSER_CHANNEL=chrome to use an installed Chrome.',
    );
  }
}

/** The platform answered with something we cannot parse: its API probably changed. */
export class PlatformChangedError extends MercatorumError {
  constructor(what: string, detail: string) {
    super(
      `Unexpected response from ${what}: ${detail}`,
      'PLATFORM_CHANGED',
      'Please open an issue on GitHub.',
    );
  }
}

export class HttpError extends MercatorumError {
  constructor(
    readonly status: number,
    url: string,
    body: string,
  ) {
    super(`HTTP ${status} on ${url}${body ? `: ${body.slice(0, 200)}` : ''}`, 'HTTP_ERROR');
  }
}

export class NotFoundError extends MercatorumError {
  constructor(what: string) {
    super(`${what} not found.`, 'NOT_FOUND');
  }
}

export function formatError(err: unknown): string {
  if (err instanceof MercatorumError) return err.hint ? `${err.message} ${err.hint}` : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
