# Agent Studio — MCP Strategy

> Phase 13
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

The Model Context Protocol (MCP) is Agent Studio's standard mechanism for
connecting external tools and data sources. Native MCP support keeps the core
small and lets the ecosystem extend capabilities — the same design validated by
Goose (extensions = MCP servers) and adopted by Claude Code and others.

---

## 1. Why MCP is Strategic

- **One protocol, unlimited integrations:** filesystem, GitHub, Jira, Slack,
  Teams, databases, cloud platforms, and custom servers all speak MCP.
- **Ecosystem leverage:** we benefit from the growing catalog of community MCP
  servers instead of writing bespoke integrations.
- **Isolation:** MCP servers run as separate processes (stdio) or remote services
  (HTTP), naturally containing third-party code away from the core.
- **Alignment:** MCP is becoming the de-facto standard for agent-tool interop.

Agent Studio is an **MCP client** (host). It does not need to *be* an MCP server,
though exposing Agent Studio capabilities as an MCP server is a possible future.

---

## 2. Protocol Support

MCP uses **JSON-RPC 2.0** with these standard transports (validated against the
MCP spec):

- **stdio** — client launches the server as a subprocess; newline-delimited
  JSON-RPC over stdin/stdout; stderr for logs. Preferred for local servers;
  clients should support it whenever possible.
- **Streamable HTTP** — single MCP endpoint (POST; replies as a JSON object or a
  request-scoped SSE stream). Preferred for remote/hosted servers. (This replaced
  the older HTTP+SSE transport; support the current spec and handle backward
  compatibility where feasible.)

Support surfaces:
- **Tools** — functions the agent can call (the main surface).
- **Resources** — read-only context the agent can pull in.
- **Prompts** — reusable server-provided prompt templates.

v1 targets **stdio + Streamable HTTP**, tools + resources; prompts and advanced
features (sampling, elicitation) phased.

---

## 3. Architecture

```
Agent Engine ──▶ Permission gate ──▶ MCP Manager
                                      ├─ McpClient(stdio)  ⇄ local server process
                                      ├─ McpClient(http)   ⇄ remote server (SSE)
                                      └─ McpClient(...)     (health, retries)
                                            │
                                     discovery: tools / resources / prompts
```

- The **MCP Manager** owns connections, lifecycle, health, and discovery (cf.
  Goose's `ExtensionManager` + `McpClient` model).
- Discovered tools are registered with the agent **only after** they pass the
  permission/allowlist policy; every MCP tool call is gated and audited exactly
  like a native tool.
- Local (stdio) servers run as isolated child processes with scoped env (secrets
  stripped unless explicitly provided to that server).

---

## 4. Target Integrations (phased)

| Category | Examples | Notes |
|---|---|---|
| **Filesystem** | Local FS MCP server | Overlaps native File Manager; native path preferred, MCP optional |
| **Source forges** | GitHub, GitLab | PR/issue/repo ops (post-v1 git-forge story) |
| **Issue/PM** | Jira, Linear | Read/create issues, sync |
| **Chat/collab** | Slack, Teams | Read/post, notifications |
| **Databases** | Postgres, MySQL, etc. | Read-first; writes strongly gated |
| **Cloud** | AWS/GCP/Azure servers | High-risk; strict policy |
| **Custom** | User/enterprise servers | First-class; add by command/URL |

v1 ships the *ability to connect* stdio + HTTP servers and a small set of vetted
defaults (e.g. filesystem, a forge); the rest is user-added.

---

## 5. Configuration

- **Where:** allowed MCP servers are declared per workspace
  (`.agentstudio/workspace.json`, shareable subset) and/or app-level defaults.
- **Shape (illustrative):**
```jsonc
{
  "mcpServers": [
    { "name": "github", "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${secret:github}" },   // resolved from keychain
      "enabled": true, "permissions": { "toolsAllow": ["*"], "toolsDeny": [] } },
    { "name": "internal", "transport": "http",
      "url": "https://mcp.internal.example/mcp", "enabled": true }
  ]
}
```
- Secrets referenced via `${secret:...}` are resolved from the OS keychain by
  Identity Manager — **never** stored in the config file.

---

## 6. Security (see also `security-review.md`)

MCP is a significant trust boundary; treat every server as **untrusted third-
party code**:

- **Explicit opt-in:** servers are disabled until the user enables them; no
  auto-connect to unknown servers.
- **Tool allowlisting:** per-server allow/deny for individual tools; the user
  sees each tool's name/description/schema before enabling.
- **Permission-gated calls:** every MCP tool invocation passes the same
  mode/policy/risk gate as native actions; state-changing/destructive MCP tools
  require approval; read-only tools are low risk.
- **Process isolation & least privilege:** stdio servers run sandboxed with
  minimal env; no secrets unless explicitly provided to that server.
- **Prompt-injection awareness:** MCP resource/tool *outputs* are untrusted data,
  not instructions; they can never silently escalate permissions or trigger
  destructive actions without passing the gate.
- **Supply-chain caution:** warn on servers launched via package runners
  (`npx`/`uvx`); prefer pinned versions; surface what will be executed.
- **Egress visibility:** HTTP servers' destinations are shown and policy-governed;
  audit records the server and endpoint per call.
- **Full audit:** server, tool, args (redacted), result, decision, and approver
  recorded.

---

## 7. UX

- **MCP panel:** list configured servers, connection health, and the tools/
  resources each exposes; enable/disable; per-tool allow/deny; view schemas.
- **Add server:** by command (stdio) or URL (HTTP), with validation and a clear
  "this will run/contact X" confirmation.
- **In-session:** MCP tool calls appear in the action feed and audit like native
  tools, visually tagged with their server.

---

## 8. Roadmap Alignment

- **v0.x:** connect stdio servers, tools + resources, per-tool allowlist, gated
  calls, audit.
- **v1.0:** add Streamable HTTP, health/retry hardening, a few vetted defaults,
  secret injection from keychain.
- **Post-v1:** prompts, sampling/elicitation, forge/PM/chat/db/cloud integration
  packs, an MCP server registry/marketplace, and possibly exposing Agent Studio
  itself as an MCP server.

---

## 9. Out of Scope (v1)

- Being an MCP *server*.
- Full support for every optional MCP feature (sampling, elicitation) on day one.
- Auto-installing MCP servers without explicit user consent.
