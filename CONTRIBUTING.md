# Contributing to Agent Studio

Thanks for your interest in improving Agent Studio. This project favors a small,
clean, dependency-free core.

## Ground rules

- **No runtime dependencies.** The engine and clients run on Node.js built-ins
  only (native `fetch`, `node:test`, `node:http`, `node:readline`, TypeScript
  type-stripping). Dev-only tooling (`typescript`, `@types/node`) is acceptable.
- **Nothing hardcoded.** Never hardcode providers, models, endpoints, or
  secrets. Provider presets and defaults live in `config/`.
- **Security first.** Never log, serialize, or persist API keys. Keys stay in
  `.env.local` and are referenced by name. Route all output through the
  redacting logger.
- **Engine-first architecture.** Business logic lives in `src/engine/`; the CLI
  and web clients are thin layers over it.
- **Tests required.** Add automated tests and mock the network — no real API
  calls in tests. Reuse `src/testkit/mockFetch.ts`.

## Development

```bash
node --version            # must be >= 22.6
npm test                  # run the full suite (mocked HTTP)
npm run typecheck         # optional; requires: npm install
```

For manual end-to-end testing without a real provider, run `npm run mock` and
point an isolated `AGENT_STUDIO_DATA_DIR` at it (see `AGENTS.md`).

## Pull requests

1. Keep changes focused and small; match existing style and structure.
2. Ensure `npm test` passes and no secrets are added to tracked files.
3. Update `README.md` / `AGENTS.md` / `docs/` when behavior or commands change.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
