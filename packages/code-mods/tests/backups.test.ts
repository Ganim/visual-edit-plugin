import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBackup, readBackup, listBackups } from '../src/backups.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-backups-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('backups', () => {
  it('writes backup file at .visual-edit/backups/<basename>-<commitId>', () => {
    const file = join(tmp, 'src', 'pages', 'Home.tsx');
    mkdirSync(join(tmp, 'src', 'pages'), { recursive: true });
    writeFileSync(file, 'original content', 'utf8');
    writeBackup({ root: tmp, filePath: file, commitId: 'c0ffee01', content: 'original content' });
    const backupPath = join(tmp, '.visual-edit', 'backups', 'Home.tsx-c0ffee01');
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf8')).toBe('original content');
  });

  it('readBackup returns the persisted content', () => {
    const file = join(tmp, 'a.tsx');
    writeFileSync(file, 'hi', 'utf8');
    writeBackup({ root: tmp, filePath: file, commitId: 'aa', content: 'hi' });
    expect(readBackup({ root: tmp, filePath: file, commitId: 'aa' })).toBe('hi');
  });

  it('listBackups returns commit ids for the file in mtime order', () => {
    const file = join(tmp, 'b.tsx');
    writeFileSync(file, 'x', 'utf8');
    writeBackup({ root: tmp, filePath: file, commitId: 'aa', content: 'v1' });
    writeBackup({ root: tmp, filePath: file, commitId: 'bb', content: 'v2' });
    const ids = listBackups({ root: tmp, filePath: file });
    expect(ids).toEqual(['aa', 'bb']);
  });
});
