import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import type { AdapterHandle, GenerateResult } from './types.js';

/**
 * Extract `http(s)://...` from a Vite "Local:" stdout line. Returns null if no match.
 * Tolerates leading whitespace, the optional `➜` arrow prefix, trailing whitespace,
 * and ANSI color reset escape sequences attached directly to the URL (we pass
 * FORCE_COLOR=0 to vite, but defensive stripping is cheap).
 * Exported for unit testing.
 */
export function extractLocalUrl(line: string): string | null {
  // Strip ANSI escape codes BEFORE matching so they can't end up inside the captured URL.
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
  const m = stripped.match(/Local:\s+(https?:\/\/[^\s]+)/);
  if (!m) return null;
  return m[1]!.trim();
}

export interface StartViteInput {
  generated: GenerateResult;
  port: number;
  /** Env to pass through; should already be filtered by safeEnvPrefixes. */
  env: Record<string, string>;
  /** Called whenever vite emits a stdout line. */
  onLog?: (line: string) => void;
  /** Called when "Local: http://" line is detected. */
  onReady?: (url: string) => void;
}

export function startVite(input: StartViteInput): { process: ChildProcess; handle: Promise<AdapterHandle> } {
  const child = spawn('npx', ['vite', '--config', input.generated.viteConfigPath], {
    cwd: input.generated.ephemeralDir,
    env: { ...process.env, ...input.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handle = new Promise<AdapterHandle>((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        child.kill('SIGTERM');
        reject(new Error('startVite: timed out after 30s waiting for "Local:" line'));
      }
    }, 30_000);

    const onLine = (line: string) => {
      input.onLog?.(line);
      const url = extractLocalUrl(line);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          url,
          async stop() {
            child.kill('SIGTERM');
            await new Promise((r) => setTimeout(r, 500));
            if (!child.killed) child.kill('SIGKILL');
          },
        });
      }
    };

    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) onLine(line);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) input.onLog?.(line);
    });
    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`vite exited with code ${code} before becoming ready`));
      }
    });
    child.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });

  return { process: child, handle };
}
