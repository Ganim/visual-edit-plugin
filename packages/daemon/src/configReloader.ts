import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import { loadConfig } from '@visual-edit/project-analyzer';
import type { VisualEditConfig } from '@visual-edit/shared';
import type { FileWatcher, ExternalChange } from './fileWatcher.js';

const CONFIG_BASENAMES = ['visual-edit.config.ts', 'visual-edit.config.js', 'visual-edit.config.mjs'];

export interface ConfigChangedEvent {
  config: VisualEditConfig | null;
  error: unknown | null;
}

export class ConfigReloader extends EventEmitter {
  constructor(private readonly root: string, private readonly fileWatcher: FileWatcher) {
    super();
  }

  /** Watch all known config file basenames so any of them trigger a reload. */
  async attach(): Promise<void> {
    const { join } = await import('node:path');
    const { existsSync } = await import('node:fs');
    for (const name of CONFIG_BASENAMES) {
      const full = join(this.root, name);
      if (existsSync(full)) {
        await this.fileWatcher.watch(full);
      }
    }

    this.fileWatcher.on('external-change', (e: ExternalChange) => {
      if (!CONFIG_BASENAMES.includes(basename(e.filePath))) return;
      this.reload();
    });
  }

  private reload(): void {
    loadConfig(this.root).then(
      (config) => { this.emit('changed', { config, error: null } satisfies ConfigChangedEvent); },
      (error) => { this.emit('changed', { config: null, error } satisfies ConfigChangedEvent); },
    );
  }
}
