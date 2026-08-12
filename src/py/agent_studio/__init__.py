"""Agent Studio — Python runtime.

A standard-library-only (zero runtime dependencies) counterpart to the
TypeScript engine. It shares the same on-disk config and conversation formats,
so the two runtimes interoperate, and it can run standalone or as a
process-isolated tool host driven by the TypeScript engine over stdio.

Targets Python 3.12 and is written to stay forward-compatible: every module
uses ``from __future__ import annotations``.
"""

from __future__ import annotations

__version__ = "0.0.1"
