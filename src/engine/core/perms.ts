// Best-effort restrictive permissions for files/dirs that hold user data or
// secrets. On POSIX this sets 0600/0700 (owner-only). On Windows chmod only
// toggles the read-only bit, so this is a documented no-op there — callers must
// not rely on it as the sole protection on Windows (see the security review).

import { chmodSync } from 'node:fs';

export function restrictFile(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort; never fail the write on a permission-setting error
  }
}

export function restrictDir(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // best-effort
  }
}
