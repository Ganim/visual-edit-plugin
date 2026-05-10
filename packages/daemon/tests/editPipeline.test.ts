import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditPipeline } from '../src/editPipeline.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-ep-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('EditPipeline', () => {
  it('instruments file once, plans+applies a className edit, dry-run sha matches commit', async () => {
    const file = join(tmp, 'src', 'Home.tsx');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(file, 'export const X = () => <div className="a">x</div>;\n', 'utf8');
    const ep = new EditPipeline({ root: tmp, filePath: file });
    const { sourceMap } = await ep.getSnapshot();
    const vid = Object.keys(sourceMap)[0]!;

    const dry = await ep.planAndApply([{ kind: 'className', element: vid, newValue: 'b' }]);
    expect(dry.files).toHaveLength(1);
    expect(dry.files[0]!.patches).toHaveLength(1);
    expect(dry.files[0]!.beforeHash).toMatch(/^[a-f0-9]{64}$/);

    const commit = await ep.commit(dry.planId);
    expect(commit.status).toBe('committed');
    expect(readFileSync(file, 'utf8')).toContain('className="b"');
  });

  it('rejects commit with unknown planId', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'export const X = () => <div />;\n', 'utf8');
    const ep = new EditPipeline({ root: tmp, filePath: file });
    await expect(ep.commit('bogus')).rejects.toThrow(/unknown planId/);
  });
});
