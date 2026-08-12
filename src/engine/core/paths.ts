// Resolves project/config/data directories. All locations are overridable via
// environment variables so users can relocate config/data without code changes.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  // Walk upward until we find a package.json (project root marker).
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export interface ResolvedPaths {
  projectRoot: string;
  configDir: string;
  dataDir: string;
  settingsFile: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ResolvedPaths {
  const projectRoot = findProjectRoot(import.meta.dirname);
  const configDir = env.AGENT_STUDIO_CONFIG_DIR
    ? resolve(env.AGENT_STUDIO_CONFIG_DIR)
    : join(projectRoot, 'config');
  const dataDir = env.AGENT_STUDIO_DATA_DIR
    ? resolve(env.AGENT_STUDIO_DATA_DIR)
    : join(projectRoot, '.agentstudio');
  const settingsFile = join(dataDir, 'settings.json');
  return { projectRoot, configDir, dataDir, settingsFile };
}
