# Security Auditor

**Workflow:** `pipeline` (deterministic — no LLM required) · **Read-only** · **Secret-safe**

Scans a directory for exposed credentials and risky files.

## Steps
1. Enumerate files under the target (via `fs.summarize`, which already *skips*
   sensitive files from its listing) and separately detect sensitive filenames
   (`.env*`, `*.pem/*.key`, `id_rsa`, `.ssh/.aws/...`).
2. Scan the contents of small text files with `secrets.scan_text` for
   credential shapes (API keys, tokens, private-key blocks, assignments).
3. Report findings by severity — **only the KIND and location, never the value**.
4. Include remediation guidance (rotate, .gitignore, `git rm --cached`).

## Tools (allow-list)
`fs.summarize`, `secrets.scan_text`, `report.markdown` — all read-only.

## Safety
Read-only and secret-safe by construction: secret *values* are never emitted,
only their kind + file. Bounded by `maxSteps`.
