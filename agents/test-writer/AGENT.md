# Test Writer

**Workflow:** `agentic` (model-driven tool loop) · **Read-only**

Proposes unit tests for provided code, targeting the highest-complexity
functions first. May call `code.analyze`, `code.complexity`, `report.markdown`.

## Usage
```
agent-studio-py agents run test-writer 'Draft tests for @src/py/agent_studio/agents/tool_loop.py'
```

## Safety
Read-only allow-list; drafts test code only (never writes files); bounded by
`maxSteps`; `@file` + tool guards apply.
