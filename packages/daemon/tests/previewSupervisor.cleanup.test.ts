import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupPreviewDir } from '../src/previewSupervisor.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 've-supervisor-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('cleanupPreviewDir', () => {
  it('removes an existing directory', () => {
    const previewDir = join(workdir, 'preview-abc12345');
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(join(previewDir, 'entry.tsx'), '// ephemeral', 'utf8');

    expect(existsSync(previewDir)).toBe(true);
    cleanupPreviewDir(previewDir);
    expect(existsSync(previewDir)).toBe(false);
  });

  it('does not throw when directory does not exist', () => {
    const nonExistent = join(workdir, 'preview-nonexistent');
    expect(() => cleanupPreviewDir(nonExistent)).not.toThrow();
  });

  it('does not throw for empty string', () => {
    // Best-effort: empty string is ignored without crashing.
    expect(() => cleanupPreviewDir('')).not.toThrow();
  });

  it('removes a nested directory tree', () => {
    const previewDir = join(workdir, 'preview-nested');
    mkdirSync(join(previewDir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(previewDir, 'sub', 'deep', 'file.ts'), '// deep', 'utf8');

    cleanupPreviewDir(previewDir);
    expect(existsSync(previewDir)).toBe(false);
  });
});
