# Docker

Reproducible dev/runtime images for both runtimes, plus a local Ollama stack.
These are **authored and reviewed**; they are not built in the current
environment (Docker was not installed). Build them where Docker is available.

## Images

| File | Image | Runtime |
|---|---|---|
| `Dockerfile.node` | `node:22-slim` | TypeScript engine + CLI (zero runtime deps, runs `.ts` via type-stripping) |
| `Dockerfile.python` | `python:3.12-slim` | Python runtime + tool host (standard library only) |

Both run as non-root and copy only what the runtime needs (no secrets — see
`.dockerignore`).

## Build & run individually

```bash
# From the repo root:
docker build -f docker/Dockerfile.node   -t agent-studio-node   .
docker build -f docker/Dockerfile.python -t agent-studio-python .

# Provide your key via --env-file (never baked into the image):
docker run --rm -it --env-file .env.local agent-studio-node   doctor
docker run --rm -it --env-file .env.local agent-studio-python ask "hello"

# Tools need no key or network:
docker run --rm agent-studio-python tools list
```

## Local Ollama stack (compose)

`docker-compose.yml` runs a local Ollama server and points both runtimes at it
via a prebuilt `ollama-data/settings.json` (no cloud, no API key).

```bash
docker compose -f docker/docker-compose.yml up -d ollama
docker compose -f docker/docker-compose.yml run --rm ollama-pull      # pull llama3.2:1b
docker compose -f docker/docker-compose.yml run --rm python doctor
docker compose -f docker/docker-compose.yml run --rm node   doctor
docker compose -f docker/docker-compose.yml run --rm python ask "name two primary colors"
```

Conversations created in the containers are written back to `docker/ollama-data/`
(the bind-mounted data dir).
