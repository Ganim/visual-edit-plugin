import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { runEditPipeline } from '../src/pipeline.ts';
import { TARGETS } from '../scripts/clone-oss.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OSS_DIR = join(__dirname, '..', 'oss');

const EDITS_PER_PROJECT = 30;
const SEED = 0xC0FFEE; // deterministic random for reproducibility

class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 0xFFFFFFFF;
  }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]!; }
  pickInt(max: number): number { return Math.floor(this.next() * max); }
}

function listTsxFiles(target: typeof TARGETS[number]): string[] {
  const projectDir = join(OSS_DIR, target.name);
  const all: string[] = [];
  for (const root of target.tsxRoots) {
    const matches = fg.sync(['**/*.tsx'], { cwd: join(projectDir, root), absolute: true });
    all.push(...matches);
  }
  return all;
}

describe('OSS spike', () => {
  for (const target of TARGETS) {
    const projectDir = join(OSS_DIR, target.name);
    it(`${target.name}: ${EDITS_PER_PROJECT} random edits all pass invariants`, () => {
      if (!existsSync(projectDir)) {
        throw new Error(`OSS project not cloned: ${target.name}. Run \`npm run clone-oss\`.`);
      }
      const tsxFiles = listTsxFiles(target);
      expect(tsxFiles.length).toBeGreaterThan(0);

      const rng = new SeededRandom(SEED);
      const failures: { file: string; error: string }[] = [];

      for (let i = 0; i < EDITS_PER_PROJECT; i++) {
        const file = rng.pick(tsxFiles);
        const source = readFileSync(file, 'utf8');
        try {
          // Some files may have no JSX; pick another up to 3 times.
          let attempts = 0;
          while (attempts < 3) {
            try {
              runEditPipeline({
                filePath: file,
                source,
                pickEdit: (vids) => {
                  const vid = vids[rng.pickInt(vids.length)]!;
                  return rng.next() < 0.5
                    ? { kind: 'className', element: vid, newValue: `spike-${i}` }
                    : { kind: 'style', element: vid, newObjectText: "{ color: 'red' }" };
                },
              });
              break; // success
            } catch (e) {
              if ((e as Error).message.includes('no JSX elements found')) {
                attempts++;
                if (attempts < 3) {
                  // Try a different file.
                  const alt = rng.pick(tsxFiles);
                  if (alt !== file) {
                    runEditPipeline({
                      filePath: alt,
                      source: readFileSync(alt, 'utf8'),
                      pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'x' }),
                    });
                    break;
                  }
                }
              } else {
                throw e;
              }
            }
          }
        } catch (e) {
          failures.push({ file, error: (e as Error).message });
        }
      }

      if (failures.length > 0) {
        const summary = failures
          .slice(0, 5)
          .map((f) => `  - ${f.file}: ${f.error.slice(0, 200)}`)
          .join('\n');
        throw new Error(
          `OSS spike FAILED for ${target.name}: ${failures.length}/${EDITS_PER_PROJECT} failures.\nFirst 5:\n${summary}`,
        );
      }
    }, 60_000);
  }
});
