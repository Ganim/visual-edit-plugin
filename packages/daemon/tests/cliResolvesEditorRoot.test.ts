import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

describe('editor-ui dist resolution', () => {
  it('editor-ui has been built and dist/index.html exists for daemon to serve', () => {
    const candidates = [
      join(__dirname, '../../editor-ui/dist/index.html'),
    ];
    const found = candidates.find(existsSync);
    expect(found, `expected editor-ui dist to exist; checked ${candidates.join(', ')}`).toBeDefined();
  });
});
