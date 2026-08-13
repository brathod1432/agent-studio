# Research Summarizer

**Workflow:** `agentic` (model-driven tool loop) · **Read-only**

Summarizes long text/files into key points. May call `text.summarize`,
`text.stats`, and `fs.summarize`.

## Usage
```
agent-studio-py agents run research-summarizer 'Summarize @notes.md'
```

## Safety
Read-only allow-list; bounded by `maxSteps`; `@file` + tool guards apply.
