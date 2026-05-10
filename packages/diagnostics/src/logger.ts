import type { ErrorEnvelope } from './envelope.js';
import { redactContext } from './redaction.js';
import { FileSink } from './fileSink.js';

export interface LogSink {
  write(line: string): void;
}

export interface LogContext {
  envelope?: ErrorEnvelope;
  [k: string]: unknown;
}

export interface LoggerOptions {
  sink?: LogSink;
  /** When true (default), unknown context fields are replaced with <HASH:...> placeholders. */
  redact?: boolean;
  /** When set, ALSO mirror logs to .visual-edit/logs/<YYYY-MM-DD>/daemon.log. */
  fsRoot?: string;
}

export class Logger {
  private sink: LogSink;
  private redact: boolean;
  private fileSink: FileSink | null;

  constructor(opts: LoggerOptions = {}) {
    this.sink = opts.sink ?? { write: (s) => process.stderr.write(s) };
    this.redact = opts.redact ?? true;
    this.fileSink = opts.fsRoot ? new FileSink({ root: opts.fsRoot }) : null;
  }

  private emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, ctx?: LogContext): void {
    const safe = ctx && this.redact ? redactContext(ctx) : ctx;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(safe ?? {}),
    }) + '\n';
    this.sink.write(line);
    this.fileSink?.write(line);
  }

  info(msg: string, ctx?: LogContext): void { this.emit('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this.emit('warn', msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.emit('error', msg, ctx); }
  debug(msg: string, ctx?: LogContext): void { this.emit('debug', msg, ctx); }
}
