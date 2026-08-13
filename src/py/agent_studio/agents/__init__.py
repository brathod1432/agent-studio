"""Agent framework: specialized agents loaded from the top-level ``agents/``
catalog, each with a least-privilege tool allow-list and safety policy.

Layout:
  spec      - AgentSpec dataclass + single-agent loader
  catalog   - discover all agents from the shared ``agents/`` directory
  policy    - AgentPolicy + tool allow-list / read-only enforcement
  tool_loop - the model-driven tool-calling loop (used by agentic agents)
  runner    - execute an agent (pipeline or agentic)
  workflows - deterministic Python pipelines (code_review, security_audit)
"""

from __future__ import annotations
