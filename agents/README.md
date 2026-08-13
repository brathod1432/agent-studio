# Agents

This directory is the **single source of truth** for Agent Studio's specialized
agents (like `config/` is for providers). Each agent is a self-contained,
least-privilege unit with its own prompt, tool allow-list, and safety policy.
Both runtimes load these manifests: the **Python runtime executes agents**
(the "brains"), and the **TypeScript CLI drives them over the stdio bridge**.

## Layout

```
agents/
  <agent-id>/
    manifest.json   machine-readable spec (runtime, workflow, tools, policy, prompt)
    prompt.md       the agent's system prompt / persona
    AGENT.md        human docs: purpose, workflow, tools, safety notes
```

## Manifest schema (`manifest.json`)

| field | meaning |
|---|---|
| `id` | stable identifier (matches the directory name) |
| `name` / `description` | human-facing |
| `workflow` | `pipeline` (deterministic Python steps) or `agentic` (model-driven tool loop) |
| `pipeline` | pipeline name (only when `workflow = pipeline`) |
| `tools` | allow-list of tool names the agent may use (least privilege) |
| `policy.readOnly` | agent may only use read-only tools (enforced) |
| `policy.autoApprove` | tool calls run without a prompt (safe because tools are read-only) |
| `policy.maxSteps` | max tool-call steps per run (bounds cost/loops) |
| `promptFile` | prompt file name (default `prompt.md`) |

## Security model

- **Least privilege:** an agent can only invoke the tools in its `tools`
  allow-list; the runner rejects any other tool call.
- **Read-only by default:** `readOnly` agents are refused any non-read-only
  tool; our built-in tools never write, exec, or leave the workspace.
- **Sensitive-data guards** in the tools themselves still apply (e.g.
  `fs.summarize` skips `.env`/keys; `code.analyze` refuses secret files).
- **Bounded:** every run has a `maxSteps` budget.

## Agents

| id | workflow | purpose |
|---|---|---|
| `code-reviewer` | pipeline | Static review of Python files (AST metrics + heuristics) → Markdown report |
| `security-auditor` | pipeline | Scan a directory for exposed secrets / sensitive files → findings report |
| `data-analyst` | agentic | Answer questions over CSV/JSON you provide |
| `doc-writer` | agentic | Draft documentation from code/context |
| `research-summarizer` | agentic | Summarize long text / files into key points |

## Run

```
# Python (executes the agent)
agent-studio-py agents list
agent-studio-py agents show code-reviewer
agent-studio-py agents run security-auditor ./src
agent-studio-py agents run data-analyst "which row has the largest value? @data.csv"

# TypeScript (drives the Python agent over the bridge)
agent-studio agents list
agent-studio agents run code-reviewer ./src/py/agent_studio/agent.py
```
