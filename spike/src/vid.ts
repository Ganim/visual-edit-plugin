import { createHash } from 'node:crypto';

export interface VidInput {
  filePath: string;
  start: number;
  end: number;
  tagName: string;
}

export function computeVid(input: VidInput): string {
  const key = `${input.filePath}\x00${input.start}\x00${input.end}\x00${input.tagName}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}
