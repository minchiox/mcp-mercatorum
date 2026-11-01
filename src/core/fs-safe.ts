import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PathOutsideWorkspaceError } from './errors.js';

const isInside = (root: string, p: string): boolean => p === root || p.startsWith(root + path.sep);

/** Deepest existing ancestor of `p`, resolved through symlinks. */
function realpathOfExisting(p: string): string {
  let cur = p;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return path.join(real, path.relative(cur, p));
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      cur = parent;
    }
  }
}

/**
 * Resolves `rel` against `root` and refuses anything that escapes it,
 * including `..` segments, absolute paths and symlinks pointing outside.
 */
export function resolveInside(root: string, rel: string): string {
  const absRoot = path.resolve(root);
  const dest = path.resolve(absRoot, rel);
  if (!isInside(absRoot, dest)) throw new PathOutsideWorkspaceError(rel);
  const realRoot = realpathOfExisting(absRoot);
  if (!isInside(realRoot, realpathOfExisting(dest))) throw new PathOutsideWorkspaceError(rel);
  return dest;
}

/** Writes via a temp file + rename, so an interrupted download never leaves a truncated file behind. */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Creates a directory readable only by the current user. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* not supported on some filesystems (e.g. Windows) */
  }
}

/** Makes a file readable only by the current user; no-op where unsupported. */
export function makePrivate(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows / exotic filesystems */
  }
}
