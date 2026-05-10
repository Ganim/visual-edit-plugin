import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import archiver from 'archiver';

export interface RunDiagnoseInput {
  root: string;
  since: string | null;
  includeRaw: boolean;
  output: string | null; // path to write zip to; default: visual-edit-diagnose-<ts>.zip in cwd
}

export async function runDiagnose(input: RunDiagnoseInput): Promise<string> {
  const logsRoot = join(input.root, '.visual-edit', 'logs');
  if (!existsSync(logsRoot)) {
    throw new Error(`no logs found at ${logsRoot}`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = input.output ?? join(process.cwd(), `visual-edit-diagnose-${ts}.zip`);

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve());
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    // Include logs/<date>/* (excluding raw-logs/).
    const dates = readdirSync(logsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const date of dates) {
      archive.directory(join(logsRoot, date), `logs/${date}`);
    }
    if (input.includeRaw) {
      const rawRoot = join(input.root, '.visual-edit', 'raw-logs');
      if (existsSync(rawRoot)) {
        archive.directory(rawRoot, 'raw-logs');
      }
    }
    archive.finalize();
  });

  return outPath;
}
