import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditPipeline } from '../src/pipeline.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '__fixtures__/tsx');

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort();

describe('fixture pipeline', () => {
  for (const file of fixtures) {
    it(`${file} — className edit on first element`, () => {
      const source = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      const result = runEditPipeline({
        filePath: file,
        source,
        pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'spike-edited' }),
      });
      expect(result.after).toContain('className="spike-edited"');
    });

    it(`${file} — style edit on first element`, () => {
      const source = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      const result = runEditPipeline({
        filePath: file,
        source,
        pickEdit: (vids) => ({
          kind: 'style',
          element: vids[0]!,
          newObjectText: "{ color: 'red', padding: 4 }",
        }),
      });
      expect(result.after).toContain("color: 'red'");
    });

    it(`${file} — className edit on every element, sequentially`, () => {
      let source = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      // Re-instrument each pass (vids stable per position so they regenerate).
      let pass = 0;
      while (true) {
        pass++;
        const result = runEditPipeline({
          filePath: file,
          source,
          pickEdit: (vids) => ({
            kind: 'className',
            element: vids[pass % vids.length]!,
            newValue: `pass-${pass}`,
          }),
        });
        source = result.after;
        if (pass > 5) break;
      }
      expect(source).toContain('pass-');
    });
  }
});
