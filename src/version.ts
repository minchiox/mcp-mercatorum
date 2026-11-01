import { readFileSync } from 'node:fs';

/** Version from package.json (works from both src/ and dist/, which sit one level below the root). */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
