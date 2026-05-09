import type { IpcMessage } from '@visual-edit/protocol';

export function sendToParent(proc: NodeJS.Process, msg: IpcMessage): void {
  if (typeof proc.send !== 'function') {
    throw new Error('preview-worker: no IPC channel — must be spawned with stdio: [..., "ipc"]');
  }
  proc.send(msg);
}
