import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, invalidateAnalyzer } from '../src/index.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-cache-'));
  mkdirSync(join(tmp, 'src'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 's', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/Home.tsx'), 'export default () => null;');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('analyze cache', () => {
  it('returns the same instance on second call (cache hit)', async () => {
    const a = await analyze(tmp);
    const b = await analyze(tmp);
    expect(a).toBe(b);
  });

  it('invalidate(filePath) forces re-analysis', async () => {
    const a = await analyze(tmp);
    invalidateAnalyzer(tmp, join(tmp, 'src/Home.tsx'));
    const b = await analyze(tmp);
    expect(a).not.toBe(b);
  });
});
