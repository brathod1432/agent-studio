// Warn if the secret file (.env.local) is exposed to git — a common way API
// keys leak. The pure `envFileWarnings` is unit-tested; `checkEnvFile` is a thin
// wrapper that gathers git facts via `git` (no-op outside a git repo).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function envFileWarnings(o: {
  exists: boolean;
  tracked: boolean;
  ignored: boolean;
  name?: string;
}): string[] {
  const name = o.name ?? '.env.local';
  if (!o.exists) return [];
  if (o.tracked) {
    return [
      `${name} is TRACKED by git — your API key may get committed. ` +
        `Fix: git rm --cached ${name}  (and ensure it is in .gitignore).`,
    ];
  }
  if (!o.ignored) {
    return [`${name} is not git-ignored — add it to .gitignore so secrets aren't committed.`];
  }
  return [];
}

function git(args: string[], cwd: string): number {
  try {
    return spawnSync('git', args, { cwd, stdio: 'ignore', timeout: 5000 }).status ?? 1;
  } catch {
    return 1;
  }
}

export function checkEnvFile(projectRoot: string, name = '.env.local'): string[] {
  if (!existsSync(join(projectRoot, name))) return [];
  if (git(['rev-parse', '--is-inside-work-tree'], projectRoot) !== 0) return [];
  const tracked = git(['ls-files', '--error-unmatch', name], projectRoot) === 0;
  const ignored = git(['check-ignore', '-q', name], projectRoot) === 0;
  return envFileWarnings({ exists: true, tracked, ignored, name });
}
