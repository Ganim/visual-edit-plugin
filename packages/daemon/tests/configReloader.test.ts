import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWatcher } from '../src/fileWatcher.js';
import { ConfigReloader, type ConfigChangedEvent } from '../src/configReloader.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cr-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const VALID_CONFIG = `export default { wrapPage: (c) => c };`;

describe('ConfigReloader', () => {
  it('emits "changed" when config file is modified', async () => {
    const configFile = join(tmp, 'visual-edit.config.ts');
    writeFileSync(configFile, VALID_CONFIG, 'utf8');

    const fw = new FileWatcher();
    const cr = new ConfigReloader(tmp, fw);
    await cr.attach();

    const events: ConfigChangedEvent[] = [];
    cr.on('changed', (e: ConfigChangedEvent) => events.push(e));

    // Modify the config file — FileWatcher should pick this up and trigger ConfigReloader.
    writeFileSync(configFile, `export default { wrapPage: (c) => c, routes: [] };`, 'utf8');

    await wait(1500);

    expect(events.length).toBeGreaterThan(0);

    await fw.close();
  }, 30_000);
});
