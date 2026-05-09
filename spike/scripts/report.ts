import { execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'SPIKE_RESULTS.json');

interface SuiteResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

const suites: { name: string; command: string }[] = [
  { name: 'unit (instrument/planEdits/apply/vid/pipeline/invariants)', command: 'npx vitest run tests/instrument.test.ts tests/planEdits.test.ts tests/apply.test.ts tests/vid.test.ts tests/pipeline.test.ts tests/invariants/' },
  { name: 'fixtures (10 TSX × 3 ops)', command: 'npx vitest run tests/fixtures.test.ts' },
  { name: 'property (1000 iterations)', command: 'npx vitest run tests/property.test.ts' },
  { name: 'oss (3 projects × 30 edits)', command: 'npx vitest run tests/oss.test.ts' },
];

function runSuite(s: { name: string; command: string }): SuiteResult {
  const start = Date.now();
  try {
    const output = execSync(s.command, { encoding: 'utf8', stdio: 'pipe' });
    return { name: s.name, command: s.command, passed: true, output: output.slice(-2000), durationMs: Date.now() - start };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return {
      name: s.name,
      command: s.command,
      passed: false,
      output: ((err.stdout ?? '') + '\n' + (err.stderr ?? '') + '\n' + err.message).slice(-2000),
      durationMs: Date.now() - start,
    };
  }
}

function main(): void {
  const results = suites.map(runSuite);
  const allPassed = results.every((r) => r.passed);
  const summary = { allPassed, runAt: new Date().toISOString(), results };
  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\n=== SPIKE REPORT ===`);
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name}  (${r.durationMs}ms)`);
  }
  console.log(`\nGo/No-Go: ${allPassed ? 'GO' : 'NO-GO'}`);
  if (!allPassed) process.exit(1);
}

main();
