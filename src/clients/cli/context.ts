// Shared CLI helper: expand @file references in a message and report what was
// included. Used by both `chat` and `ask`. The `report` sink lets each caller
// choose where notes go (stdout for chat, stderr for ask to keep stdout clean).

import { expandFileReferences } from '../../engine/index.ts';

export function applyFileContext(
  input: string,
  report: (line: string) => void,
  opts: { allowAny?: boolean } = {},
): string {
  const { text, refs } = expandFileReferences(input, {
    allowOutside: opts.allowAny,
    allowSensitive: opts.allowAny,
  });
  for (const r of refs) {
    if (r.ok) {
      const kb = r.bytes != null ? ` (${Math.max(1, Math.round(r.bytes / 1024))} KB)` : '';
      report(`  + included @${r.ref}${kb}${r.truncated ? ' [truncated]' : ''}`);
    } else if (r.blocked) {
      report(`  ⨯ blocked @${r.ref}: ${r.error}`);
    } else {
      report(`  ! could not read @${r.ref}: ${r.error}`);
    }
  }
  return text;
}
