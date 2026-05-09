import type { ErrorEnvelope } from './envelope.js';

export interface LogSink {
  write(line: string): void;
}

export interface LogContext {
  envelope?: ErrorEnvelope;
  [k: string]: unknown;
}

export class Logger {
  constructor(private sink: LogSink = { write: (s) => process.stderr.write(s) }) {}

  private emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, ctx?: LogContext): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(ctx ?? {}),
    }) + '\n';
    this.sink.write(line);
  }

  info(msg: string, ctx?: LogContext): void { this.emit('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this.emit('warn', msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.emit('error', msg, ctx); }
  debug(msg: string, ctx?: LogContext): void { this.emit('debug', msg, ctx); }
}
