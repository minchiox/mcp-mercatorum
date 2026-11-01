import { HostNotAllowedError } from './errors.js';
import { ALLOWED_HOST_SUFFIXES, API_HOST, SAFE_WRITE_PATH_RE, TRACKING_PATH_RE } from './platform.js';

export type Verdict = { allow: true } | { allow: false; reason: string };

/**
 * Decides whether a request may leave the machine. Applied both to the browser
 * (via request routing) and to every direct HTTP call, so the guarantee holds for all tools:
 * - attendance/progress tracking endpoints are always blocked, whatever the method;
 * - non-GET requests to the student API are blocked unless they are session maintenance or pure reads.
 */
export function classifyRequest(method: string, url: string): Verdict {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { allow: true }; // data:, blob: and similar never reach the network
  }
  if (TRACKING_PATH_RE.test(u.pathname)) {
    return { allow: false, reason: 'attendance/progress tracking endpoint (this tool is read-only)' };
  }
  const m = method.toUpperCase();
  if (u.host === API_HOST && m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    if (!SAFE_WRITE_PATH_RE.test(u.pathname)) {
      return { allow: false, reason: 'write request to the student API (this tool is read-only)' };
    }
  }
  return { allow: true };
}

export function isHostAllowed(url: string, extra: readonly string[] = []): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return [...ALLOWED_HOST_SUFFIXES, ...extra].some((s) => host === s || host.endsWith(`.${s}`));
}

export function assertHostAllowed(url: string, extra: readonly string[] = []): void {
  if (!isHostAllowed(url, extra)) throw new HostNotAllowedError(url);
}
