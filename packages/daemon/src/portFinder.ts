import { createServer } from 'node:net';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export async function findFreePort(rangeStart: number, rangeEnd: number): Promise<number> {
  for (let p = rangeStart; p <= rangeEnd; p++) {
    if (await isFree(p)) return p;
  }
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_PREVIEW_003_PORT_EXHAUSTED,
    message: `${CODES.VE_PREVIEW_003_PORT_EXHAUSTED}: no free port in range ${rangeStart}-${rangeEnd}`,
    severity: 'fatal',
    recovery: 'user-action',
    blame: 'environment',
    hint: 'Stop other dev servers or pick a different port range via VE_PORT_RANGE env.',
  }));
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}
