import { describe, it, expect } from 'vitest';
import { extractLocalUrl, startVite } from '../src/spawn.js';

describe('extractLocalUrl', () => {
  it('parses Vite 5 default Local: line', () => {
    expect(extractLocalUrl('  Local:   http://localhost:5180/')).toBe('http://localhost:5180/');
  });

  it('parses Vite 5 line with arrow prefix', () => {
    expect(extractLocalUrl('  ➜  Local:   http://localhost:5180/')).toBe('http://localhost:5180/');
  });

  it('parses 127.0.0.1 host (strictly bound)', () => {
    expect(extractLocalUrl('  Local:   http://127.0.0.1:5181/')).toBe('http://127.0.0.1:5181/');
  });

  it('returns null for non-Local lines', () => {
    expect(extractLocalUrl('  Network: use --host to expose')).toBeNull();
    expect(extractLocalUrl('VITE v5.4.10 ready')).toBeNull();
    expect(extractLocalUrl('')).toBeNull();
  });

  it('strips trailing whitespace', () => {
    expect(extractLocalUrl('  Local:   http://localhost:5180/   ')).toBe('http://localhost:5180/');
  });

  it('strips ANSI color escape sequences attached to the URL', () => {
    // \x1b[36m = cyan, \x1b[0m = reset. Vite emits these when stdout is a TTY.
    expect(extractLocalUrl('  Local:   \x1b[36mhttp://localhost:5180/\x1b[0m')).toBe('http://localhost:5180/');
  });
});

describe('startVite (export shape)', () => {
  it('is exported as a function', () => {
    expect(typeof startVite).toBe('function');
  });
});
