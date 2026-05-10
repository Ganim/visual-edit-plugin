import { describe, it, expect } from 'vitest';
import {
  WsEditMessage,
  WsDryRunMessage,
  WsCommitMessage,
  WsCommitOkMessage,
  WsCommitUncertainMessage,
  WsFileChangedMessage,
  WsErrorMessage,
  WsSnapshotMessage,
} from '../src/ws.js';

describe('ws editing schemas', () => {
  it('parses an edit message with a single className edit', () => {
    const parsed = WsEditMessage.parse({
      kind: 'edit',
      requestId: 'req1',
      sessionId: 's1',
      edits: [{ kind: 'className', element: 'abc12345', newValue: 'p-4' }],
    });
    expect(parsed.edits).toHaveLength(1);
  });

  it('parses a dry-run reply with patches + hashes', () => {
    expect(() => WsDryRunMessage.parse({
      kind: 'dry-run',
      requestId: 'req1',
      sessionId: 's1',
      planId: 'plan1',
      filePath: '/abs/Home.tsx',
      patches: [{ start: 0, end: 1, replacement: 'x', reason: 'r' }],
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
    })).not.toThrow();
  });

  it('parses commit + commit-ok + commit-uncertain', () => {
    WsCommitMessage.parse({ kind: 'commit', requestId: 'r', sessionId: 's', planId: 'p' });
    WsCommitOkMessage.parse({ kind: 'commit-ok', requestId: 'r', sessionId: 's', commitId: 'c' });
    WsCommitUncertainMessage.parse({ kind: 'commit-uncertain', requestId: 'r', sessionId: 's', lastError: 'EPERM' });
  });

  it('parses file-changed and error messages', () => {
    WsFileChangedMessage.parse({ kind: 'file-changed', sessionId: 's', filePath: '/abs/x.tsx', sha256: 'a'.repeat(64), dirtySourceMap: true });
    WsErrorMessage.parse({ kind: 'error', sessionId: 's', code: 'VE_CODEMOD_003', message: 'stale' });
  });

  it('snapshot now carries sourceMap, sourceText, editorUrl', () => {
    const m = WsSnapshotMessage.parse({
      kind: 'snapshot',
      sessionId: 's1',
      url: 'http://127.0.0.1:5180',
      status: 'ready',
      filePath: '/abs/Home.tsx',
      sourceText: 'export const X = () => <div />;\n',
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 10, openingTagEnd: 5, classNameAttr: null, styleAttr: null, attrsInsertPos: 5 } },
      editorUrl: 'http://127.0.0.1:5170/__editor/?session=s1',
    });
    expect(m.sourceMap['abc12345']!.tagName).toBe('div');
  });
});
