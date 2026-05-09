#!/usr/bin/env node
import { generateEphemeralPreview, startVite } from '@visual-edit/adapter-vite';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import { sendToParent } from './ipc.js';

let stopRequested = false;

async function main(): Promise<void> {
  if (typeof process.send !== 'function') {
    throw new Error('preview-worker must be spawned with IPC channel');
  }

  // Wait for AdapterInput from parent.
  const input = await new Promise<AdapterInput>((resolve, reject) => {
    const onMsg = (msg: unknown) => {
      const m = msg as { kind?: string; adapterInput?: AdapterInput };
      if (m && m.kind === 'start' && m.adapterInput) {
        process.off('message', onMsg);
        resolve(m.adapterInput);
      }
    };
    process.on('message', onMsg);
    setTimeout(() => reject(new Error('preview-worker: no AdapterInput received within 30s')), 30_000);
  });

  try {
    const generated = await generateEphemeralPreview(input);
    const { process: viteProc, handle } = startVite({
      generated,
      port: input.port,
      env: input.env,
      onLog: (line) => process.stderr.write(line + '\n'),
    });

    process.on('SIGTERM', async () => {
      if (stopRequested) return;
      stopRequested = true;
      const h = await handle.catch(() => null);
      if (h) await h.stop();
      viteProc.kill('SIGTERM');
      process.exit(0);
    });

    const h = await handle;
    sendToParent(process, { kind: 'ready', url: h.url });
  } catch (err) {
    const e = err as Error;
    sendToParent(process, { kind: 'error', message: e.message, stack: e.stack });
    process.exit(1);
  }
}

main().catch((err) => {
  // Should be unreachable; main has its own try/catch.
  process.stderr.write(`preview-worker fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
