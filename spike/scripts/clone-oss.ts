import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OSS_DIR = join(__dirname, '..', 'oss');

interface OssTarget {
  name: string;
  repo: string;
  sha: string;
  /** Glob roots within the repo where TSX files we care about live. */
  tsxRoots: string[];
}

// Pinned to specific SHAs for reproducibility. Update only with explicit re-validation.
const TARGETS: OssTarget[] = [
  {
    name: 'vite-react-ts-template',
    repo: 'https://github.com/vitejs/vite.git',
    // Original plan SHA 9f5c59f0... no longer reachable upstream; pinned to current main HEAD.
    sha: 'cf0ff4154b26cffbf18541ade1a50818842731d3',
    tsxRoots: ['packages/create-vite/template-react-ts/src'],
  },
  {
    name: 'cra-typescript-template',
    repo: 'https://github.com/facebook/create-react-app.git',
    sha: '67b48688081d8ee3562b8ac1bf6ae6d44112745a',
    tsxRoots: ['packages/cra-template-typescript/template/src'],
  },
  {
    name: 'shadcn-ui-components',
    repo: 'https://github.com/shadcn-ui/ui.git',
    // Original plan tsxRoot apps/www/registry/default/ui no longer exists in current shadcn-ui
    // layout (repo restructured to apps/v4/...). Pinned to current main HEAD with new path.
    sha: 'b8608d0976b32e26136e182445f69e6eb8e6cb74',
    tsxRoots: ['apps/v4/registry/new-york-v4/ui'],
  },
];

function run(cmd: string, cwd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function cloneTarget(t: OssTarget): void {
  const dest = join(OSS_DIR, t.name);
  if (existsSync(dest)) {
    console.log(`[skip] ${t.name} already cloned at ${dest}`);
    return;
  }
  mkdirSync(OSS_DIR, { recursive: true });
  run(`git clone --filter=blob:none --no-checkout ${t.repo} ${t.name}`, OSS_DIR);
  run(`git checkout ${t.sha}`, dest);
}

async function main(): Promise<void> {
  for (const t of TARGETS) {
    try {
      cloneTarget(t);
    } catch (err) {
      console.error(`[fail] clone ${t.name}:`, err);
      process.exit(1);
    }
  }
  console.log('\nAll OSS targets ready in', OSS_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { TARGETS };
export type { OssTarget };
