// Logs go to stderr only: stdout is the MCP stdio channel and must carry protocol messages alone.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  return value && value in ORDER ? (value as LogLevel) : fallback;
}

export function createLogger(level: LogLevel = 'info', sink: (line: string) => void = defaultSink): Logger {
  const at =
    (lvl: Exclude<LogLevel, 'silent'>) =>
    (msg: string, data?: unknown): void => {
      if (ORDER[lvl] < ORDER[level]) return;
      const suffix =
        data === undefined ? '' : ` ${data instanceof Error ? data.message : JSON.stringify(data)}`;
      sink(`[mercatorum] ${lvl.toUpperCase()} ${msg}${suffix}`);
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

function defaultSink(line: string): void {
  console.error(line);
}

export const silentLogger: Logger = createLogger('silent');
