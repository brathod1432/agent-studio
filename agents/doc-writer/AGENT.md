# Doc Writer

**Workflow:** `agentic` (model-driven tool loop) · **Read-only**

Drafts documentation grounded in your code/context. May call `code.analyze`,
`fs.summarize`, `text.summarize`, and `report.markdown`.

## Usage
```
agent-studio-py agents run doc-writer 'Write a README section for @src/py/agent_studio/agent.py'
```

## Safety
Read-only allow-list; bounded by `maxSteps`; tool + `@file` guards apply.
