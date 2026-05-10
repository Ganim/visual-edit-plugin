import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import {
  instrument,
  planEdits,
  apply,
  commit as commitWrite,
  rollback as rollbackWrite,
  writeBackup,
  appendCommit,
  type ElementSourceMap,
  type TextPatch,
  type CommitResult,
} from '@visual-edit/code-mods';
import type { Edit } from '@visual-edit/shared';

export interface EditPipelineOpts {
  root: string;
  filePath: string;
  /** Called after any disk write the pipeline performs (initial instrument, commit, rollback). */
  onSelfWrite?: (filePath: string, sha256: string) => void;
}

export interface DryRunArtifact {
  planId: string;
  patches: TextPatch[];
  beforeHash: string;
  afterHash: string;
  newContent: string;
}

export interface InstrumentSnapshot {
  sourceText: string;       // instrumented source (with data-vid attributes injected)
  sourceMap: ElementSourceMap;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Per-session, per-file edit pipeline.
 *
 * - Caches the instrumented source + sourceMap (lazy first call).
 * - Persists data-vid attributes to disk on first instrument so subsequent runs are stable
 *   and the editor's selectors remain valid across edits.
 * - Initial instrumentation goes through backup + commit log (kind: 'instrument') and
 *   registers self-write so FileWatcher doesn't fire spurious external-change events.
 * - Holds dry-run artifacts in-memory keyed by planId; commit() consumes them.
 */
export class EditPipeline {
  private snapshot: InstrumentSnapshot | null = null;
  private dryRuns = new Map<string, DryRunArtifact>();

  constructor(private opts: EditPipelineOpts) {}

  /** Public so WS handlers don't need to cast. */
  getFilePath(): string { return this.opts.filePath; }

  async getSnapshot(): Promise<InstrumentSnapshot> {
    if (this.snapshot) return this.snapshot;
    const original = readFileSync(this.opts.filePath, 'utf8');
    const { instrumented, sourceMap } = instrument(original, this.opts.filePath);
    if (instrumented !== original) {
      const commitId = randomBytes(4).toString('hex');
      const beforeHash = sha(original);
      const afterHash = sha(instrumented);
      // Backup the pre-instrument content so we can revert if needed.
      writeBackup({ root: this.opts.root, filePath: this.opts.filePath, commitId, content: original });
      // Atomic write so a crash mid-write doesn't leave a partial file.
      const tmp = `${this.opts.filePath}.${commitId}.tmp`;
      writeFileSync(tmp, instrumented, 'utf8');
      const fd = openSync(tmp, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, this.opts.filePath);
      // Audit trail.
      appendCommit(this.opts.root, {
        commitId,
        filePath: this.opts.filePath,
        sha256Before: beforeHash,
        sha256After: afterHash,
        kind: 'instrument',
        timestamp: new Date().toISOString(),
      });
      // Tell FileWatcher this is our write.
      this.opts.onSelfWrite?.(this.opts.filePath, afterHash);
    }
    this.snapshot = { sourceText: instrumented, sourceMap };
    return this.snapshot;
  }

  async planAndApply(edits: Edit[]): Promise<DryRunArtifact> {
    const snap = await this.getSnapshot();
    const patches = planEdits(snap.sourceText, snap.sourceMap, edits);
    const applied = apply(snap.sourceText, patches);
    const planId = randomBytes(4).toString('hex');
    const artifact: DryRunArtifact = {
      planId,
      patches,
      beforeHash: applied.beforeHash,
      afterHash: applied.afterHash,
      newContent: applied.after,
    };
    this.dryRuns.set(planId, artifact);
    return artifact;
  }

  async commit(planId: string): Promise<CommitResult> {
    const dr = this.dryRuns.get(planId);
    if (!dr) throw new Error(`commit: unknown planId ${planId}`);
    const result = await commitWrite({
      root: this.opts.root,
      filePath: this.opts.filePath,
      expectedBeforeHash: dr.beforeHash,
      newContent: dr.newContent,
    });
    if (result.status === 'committed') {
      this.opts.onSelfWrite?.(this.opts.filePath, result.sha256After);
      // Refresh snapshot from the new disk content (vids are unchanged; positions shifted).
      const newContent = readFileSync(this.opts.filePath, 'utf8');
      const re = instrument(newContent, this.opts.filePath);
      this.snapshot = { sourceText: re.instrumented, sourceMap: re.sourceMap };
      this.dryRuns.delete(planId);
    }
    return result;
  }

  async rollback(commitId: string): Promise<void> {
    await rollbackWrite({ root: this.opts.root, commitId });
    const newContent = readFileSync(this.opts.filePath, 'utf8');
    this.opts.onSelfWrite?.(this.opts.filePath, sha(newContent));
    const re = instrument(newContent, this.opts.filePath);
    this.snapshot = { sourceText: re.instrumented, sourceMap: re.sourceMap };
  }
}
