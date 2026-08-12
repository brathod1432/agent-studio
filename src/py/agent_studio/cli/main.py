"""Agent Studio (Python) CLI: doctor, status, ask, chat, config.

Standalone counterpart to the TypeScript CLI, reading the same config and
conversation files. Run: ``python -m agent_studio <command>``.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
from collections.abc import Mapping
from pathlib import Path
from types import FrameType
from typing import TextIO

from .. import __version__
from ..agent import ChatAgent
from ..config.loader import (
    load_catalog,
    load_settings,
    resolve_active_provider,
    set_active_model,
    set_active_provider,
)
from ..config.types import AppSettings, ProviderConfig
from ..context import expand_file_references
from ..core.paths import resolve_paths
from ..core.secret_scan import describe_secret_kinds, detect_secrets
from ..core.secrets import load_environment
from ..factory import create_llm_from_settings
from ..llm.usage import add_usage, zero_usage
from ..memory.export import conversation_to_markdown, default_export_filename
from ..memory.store import Conversation, ConversationStore, ConversationSummary, SearchResult
from ..providers.diagnostics import format_error, format_health_report
from ..providers.errors import ProviderError
from ..providers.testing import health_check, list_models
from ..tools.base import ToolError
from ..tools.registry import default_registry


def build_env() -> dict[str, str]:
    return load_environment(os.environ, resolve_paths().project_root)


def _stdout(text: str) -> None:
    sys.stdout.write(text)


def _apply_file_context(text: str, report_to: TextIO) -> str:
    result = expand_file_references(text)
    for ref in result.refs:
        if ref.ok:
            kb = f" ({max(1, round((ref.bytes or 0) / 1024))} KB)" if ref.bytes else ""
            trunc = " [truncated]" if ref.truncated else ""
            print(f"  + included @{ref.ref}{kb}{trunc}", file=report_to)
        else:
            print(f"  ! could not read @{ref.ref}: {ref.error}", file=report_to)
    return result.text


# --------------------------------------------------------------------------
# status / doctor
# --------------------------------------------------------------------------
def cmd_version(_args: argparse.Namespace) -> int:
    print(f"agent-studio {__version__}")
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    catalog = load_catalog()
    settings = load_settings()
    active = resolve_active_provider(settings, catalog)
    print(f"Active provider:  {active.label + ' (' + active.id + ')' if active else '(none)'}")
    if active:
        print(f"Endpoint:         {active.base_url or '(not set)'}")
        print(f"Model:            {active.model or '(not set)'}")
        print(f"API key ref:      {active.api_key_ref or '(none)'}")
    return 0


def cmd_doctor(_args: argparse.Namespace) -> int:
    env = build_env()
    catalog = load_catalog()
    settings = load_settings()
    active = resolve_active_provider(settings, catalog)
    if active is None:
        print('No provider is configured. Run "onboard" (TS) or edit config first.')
        return 1
    print(f'Running health check for "{active.label}"…\n')
    report = health_check(active, env, settings.request)
    print(format_health_report(report))
    return 1 if report.overall == "error" else 0


# --------------------------------------------------------------------------
# ask (one-shot)
# --------------------------------------------------------------------------
def cmd_ask(args: argparse.Namespace) -> int:
    env = build_env()
    prompt_arg = " ".join(args.prompt).strip()
    stdin_text = "" if sys.stdin.isatty() else sys.stdin.read()
    combined = prompt_arg
    if prompt_arg and stdin_text.strip():
        combined = f"{prompt_arg}\n\n{stdin_text.rstrip()}"
    elif stdin_text.strip():
        combined = stdin_text.rstrip()
    if not combined:
        print('Usage: agent-studio-py ask [--json] "your question"  (or pipe input)', file=sys.stderr)
        return 2

    message = _apply_file_context(combined, sys.stderr)

    try:
        resolved = create_llm_from_settings(env)
    except ProviderError as err:
        print(err.message, file=sys.stderr)
        return 1

    model = getattr(args, "model", None)
    temperature = getattr(args, "temperature", None)
    effective_model = model or resolved.client.model

    store = ConversationStore(ephemeral=True)
    conversation = store.create(provider_id=resolved.config.id, model=effective_model)
    agent = ChatAgent(resolved.client, store, conversation, max_context_tokens=resolved.settings.max_context_tokens)
    try:
        if args.json:
            answer = agent.run(message, model=model, temperature=temperature)
            usage = agent.last_usage
            out = {
                "model": effective_model,
                "answer": answer,
                "usage": None
                if usage is None
                else {
                    "promptTokens": usage.prompt_tokens,
                    "completionTokens": usage.completion_tokens,
                    "totalTokens": usage.total_tokens,
                },
            }
            sys.stdout.write(json.dumps(out, indent=2) + "\n")
        else:
            agent.run_stream(message, _stdout, model=model, temperature=temperature)
            sys.stdout.write("\n")
    except ProviderError as err:
        print(format_error(err), file=sys.stderr)
        return 1
    return 0


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------
def cmd_config(args: argparse.Namespace) -> int:
    sub = args.subcommand
    catalog = load_catalog()
    settings = load_settings()
    active = resolve_active_provider(settings, catalog)
    if sub in (None, "show"):
        print("Current configuration:")
        print(f"  Active provider:  {active.label + ' (' + active.id + ')' if active else '(none)'}")
        if active:
            print(f"  Endpoint:         {active.base_url or '(not set)'}")
            print(f"  Model:            {active.model or '(not set)'}")
            print(f"  API key ref:      {active.api_key_ref or '(none)'}")
        print("\nAvailable providers:")
        for p in catalog.providers.values():
            marker = "*" if active and p.id == active.id else " "
            print(f"  {marker} {p.id}  —  {p.label}")
        return 0
    if sub == "model":
        if not args.value:
            print("Usage: config model <id>", file=sys.stderr)
            return 2
        set_active_model(args.value)
        print(f'Active model is now "{args.value}".')
        return 0
    if sub == "provider":
        if not args.value:
            print("Usage: config provider <id>", file=sys.stderr)
            return 2
        try:
            set_active_provider(args.value)
            print(f'Active provider is now "{args.value}".')
        except ValueError as err:
            print(str(err), file=sys.stderr)
            return 1
        return 0
    print("Usage: config [show | model <id> | provider <id>]", file=sys.stderr)
    return 2


# --------------------------------------------------------------------------
# tools
# --------------------------------------------------------------------------
def cmd_tools(args: argparse.Namespace) -> int:
    registry = default_registry()
    action = args.action or "list"
    if action == "list":
        for descriptor in registry.list():
            print(f"{descriptor['name']}\n  {descriptor['description']}")
        return 0
    if action == "run":
        if not args.name:
            print("Usage: tools run <name> [--args '<json>']  (or pipe JSON args on stdin)", file=sys.stderr)
            return 2
        raw = args.args
        if raw is None and not sys.stdin.isatty():
            raw = sys.stdin.read().strip() or None
        try:
            arguments = json.loads(raw) if raw else {}
        except json.JSONDecodeError as err:
            print(f"Invalid --args JSON: {err}", file=sys.stderr)
            return 2
        if not isinstance(arguments, dict):
            print("Tool arguments must be a JSON object.", file=sys.stderr)
            return 2
        try:
            result = registry.call(args.name, arguments)
        except ToolError as err:
            print(f"Tool error: {err}", file=sys.stderr)
            return 1
        sys.stdout.write(json.dumps(result, indent=2) + "\n")
        return 0
    print("Usage: tools [list | run <name>]", file=sys.stderr)
    return 2


# --------------------------------------------------------------------------
# chat (interactive)
# --------------------------------------------------------------------------
HELP = "\n".join(
    [
        "Commands:",
        "  /help      Show this help",
        "  /new       Start a new conversation",
        "  /list      List saved conversations",
        "  /resume    Resume a saved conversation (/resume <id>)",
        "  /rename    Rename the current conversation (/rename <title>)",
        "  /delete    Delete a conversation (/delete, or /delete <id>)",
        "  /search    Search saved conversations (/search <query>)",
        "  /export    Export the current conversation to Markdown (/export [path])",
        "  /model     Change the model (/model, or /model <id>)",
        "  /exit      Quit",
        "",
        'Tip: reference a file with @path (e.g. "explain @src/app.py") to add it as context.',
    ]
)


def _stream_with_cancel(agent: ChatAgent, message: str) -> bool:
    """Stream a reply, installing a SIGINT handler so Ctrl+C cancels (keeping the
    partial reply) instead of killing the process. Returns whether it cancelled."""
    cancelled = {"v": False}

    def _on_sigint(_signum: int, _frame: FrameType | None) -> None:
        cancelled["v"] = True

    previous = None
    try:
        previous = signal.getsignal(signal.SIGINT)
        signal.signal(signal.SIGINT, _on_sigint)
    except ValueError:
        previous = None  # not in the main thread
    try:
        agent.run_stream(message, _stdout, should_cancel=lambda: cancelled["v"])
    finally:
        if previous is not None:
            signal.signal(signal.SIGINT, previous)
    return cancelled["v"]


def _read_line(prompt: str) -> str | None:
    try:
        sys.stdout.write(prompt)
        sys.stdout.flush()
        return input()
    except EOFError:
        return None


def cmd_chat(args: argparse.Namespace) -> int:
    env = build_env()
    ephemeral = bool(args.no_save)
    print("==============================================")
    print("        Agent Studio (Python) — Chat")
    print("==============================================")
    try:
        resolved = create_llm_from_settings(env)
    except ProviderError as err:
        print(f"\n{err.message}")
        return 1
    client, config, settings = resolved.client, resolved.config, resolved.settings
    print(f"\nProvider: {config.label} ({config.id})   Model: {client.model}")
    if ephemeral:
        print("Ephemeral session (--no-save): nothing will be written to disk.")
    print("Type a message, or /help for commands.\n")

    store = ConversationStore(ephemeral=ephemeral)
    max_ctx = settings.max_context_tokens
    interactive = sys.stdin.isatty()

    def make_agent(conv: Conversation) -> ChatAgent:
        return ChatAgent(client, store, conv, max_context_tokens=max_ctx)

    conversation = store.create(provider_id=config.id, model=client.model)
    print("Started a new conversation.\n")
    agent = make_agent(conversation)

    session_usage = zero_usage()
    turns = 0

    while True:
        line = _read_line("you>: ")
        if line is None:
            break
        text = line.strip()
        if not text:
            continue
        if text.startswith("/"):
            cmd, _, rest = text[1:].partition(" ")
            rest = rest.strip()
            if cmd in ("exit", "quit"):
                break
            if cmd == "help":
                print(HELP)
                continue
            if cmd == "new":
                conversation = store.create(provider_id=config.id, model=client.model)
                agent = make_agent(conversation)
                print("Started a new conversation.\n")
                continue
            if cmd == "list":
                _print_summaries(store.list())
                continue
            if cmd == "resume":
                target = rest or (input("Resume which? (id): ").strip() if interactive else "")
                conv = store.try_load(target) if target else None
                if conv is None:
                    print("No matching conversation.")
                    continue
                conversation = conv
                agent = make_agent(conversation)
                _print_history(conversation)
                continue
            if cmd == "rename":
                if not rest:
                    print("Usage: /rename <new title>\n")
                    continue
                conversation.title = rest
                store.save(conversation)
                print(f'Renamed to "{rest}".\n')
                continue
            if cmd == "delete":
                target = rest or conversation.id
                deleted = store.delete(target)
                print("Deleted." if deleted else "No matching conversation.")
                if deleted and target == conversation.id:
                    conversation = store.create(provider_id=config.id, model=client.model)
                    agent = make_agent(conversation)
                    print("Started a new conversation.")
                print("")
                continue
            if cmd == "search":
                if not rest:
                    print("Usage: /search <query>\n")
                    continue
                _print_search(store.search(rest))
                continue
            if cmd == "export":
                md = conversation_to_markdown(conversation)
                path = rest or default_export_filename(conversation)
                try:
                    Path(path).write_text(md, encoding="utf-8")
                    print(f"Exported to {path}\n")
                except OSError as err:
                    print(f'Could not write "{path}": {err}\n')
                continue
            if cmd == "model":
                model = rest
                if not model:
                    model = _choose_model(config, env, settings) or ""
                    if not model:
                        print("No change made.\n")
                        continue
                try:
                    set_active_model(model)
                    resolved = create_llm_from_settings(env)
                    client, config = resolved.client, resolved.config
                    agent = make_agent(conversation)
                    print(f'Model is now "{client.model}".\n')
                except (ProviderError, ValueError) as err:
                    print(f"Could not change model: {err}\n")
                continue
            print(f"Unknown command: /{cmd}. Type /help.")
            continue

        message = _apply_file_context(text, sys.stdout)
        kinds = detect_secrets(message)
        if kinds:
            print(f"\n\u26a0 This message looks like it contains {describe_secret_kinds(kinds)}.")
            print("  It would be sent to the provider and saved in plaintext.")
            if interactive:
                ans = input("  Send and store it anyway? (y/N) ").strip().lower()
                if ans not in ("y", "yes"):
                    print("  Skipped — nothing was sent or saved.\n")
                    continue
            else:
                print("  (continuing; run interactively to be prompted)\n")

        sys.stdout.write("assistant> ")
        sys.stdout.flush()
        try:
            was_cancelled = _stream_with_cancel(agent, message)
            sys.stdout.write("\n")
            if was_cancelled:
                print("[cancelled — partial reply saved]")
            if agent.last_trimmed_count > 0:
                print(
                    f"[context] trimmed {agent.last_trimmed_count} older message(s) "
                    "to fit the context window"
                )
            usage = agent.last_usage
            if usage:
                turns += 1
                session_usage = add_usage(session_usage, usage)
                approx = "~" if agent.last_usage_estimated else ""
                est = " (est)" if agent.last_usage_estimated else ""
                print(
                    f"[tokens] this turn: prompt {approx}{usage.prompt_tokens} · "
                    f"completion {approx}{usage.completion_tokens} · total {approx}{usage.total_tokens}{est}"
                    f"   session: total {session_usage.total_tokens} across {turns} turn(s)"
                )
            print("")
        except ProviderError as err:
            sys.stdout.write("\n")
            print(format_error(err))
            print("")

    print(
        "\nGoodbye. (Ephemeral session — nothing was saved.)"
        if ephemeral
        else "\nGoodbye. Your conversation was saved automatically."
    )
    return 0


def _print_summaries(summaries: list[ConversationSummary]) -> None:
    if not summaries:
        print("  (no saved conversations yet)")
        return
    for i, s in enumerate(summaries, 1):
        print(f"  {i}. {s.title}  ·  {s.message_count} msgs  ·  {s.updated_at}")
        print(f"     id: {s.id}")


def _print_search(results: list[SearchResult]) -> None:
    if not results:
        print("  (no matches)")
        return
    for i, r in enumerate(results, 1):
        print(f"  {i}. {r.title}  ·  {r.message_count} msgs  ·  {r.updated_at}")
        print(f'     match: {r.snippet if r.matched_in == "message" and r.snippet else "title"}')
        print(f"     id: {r.id}")


def _print_history(conversation: Conversation) -> None:
    if not conversation.messages:
        return
    print(f'\n--- resuming "{conversation.title}" ({len(conversation.messages)} messages) ---')
    for m in conversation.messages:
        who = "you" if m.role == "user" else m.role
        print(f"{who}> {m.content}")
    print("--- end of history ---\n")


def _choose_model(config: ProviderConfig, env: Mapping[str, str], settings: AppSettings) -> str | None:
    try:
        print("Fetching available models…")
        models = list_models(config, env, settings.request)
    except ProviderError as err:
        print(format_error(err))
        return input("Enter a model id manually (or Enter to cancel): ").strip() or None
    if not models:
        return input("No models returned. Enter a model id manually: ").strip() or None
    for i, m in enumerate(models, 1):
        current = "  (current)" if m.id == config.model else ""
        print(f"  {i}. {m.id}{current}")
    ans = input("\nSelect a model (number or id, Enter to cancel): ").strip()
    if not ans:
        return None
    if ans.isdigit() and 1 <= int(ans) <= len(models):
        return models[int(ans) - 1].id
    return ans


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agent-studio-py", description="Agent Studio (Python runtime)")
    parser.add_argument("--version", action="version", version=f"agent-studio {__version__}")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("version", help="Print the version")
    sub.add_parser("status", help="Show current configuration (secret-safe)")
    sub.add_parser("doctor", help="Provider health check (live)")

    ask = sub.add_parser("ask", help="One-shot question (prints only the answer)")
    ask.add_argument("prompt", nargs="*", help="The question (stdin is combined as context)")
    ask.add_argument("--json", action="store_true", help="Emit a JSON result")
    ask.add_argument("--model", help="Override the model for this call only")
    ask.add_argument("--temperature", type=float, help="Override the temperature for this call only")

    chat = sub.add_parser("chat", help="Interactive conversational agent")
    chat.add_argument("--no-save", action="store_true", help="Ephemeral session (nothing written to disk)")

    cfg = sub.add_parser("config", help="View/change provider and model")
    cfg.add_argument("subcommand", nargs="?", choices=["show", "model", "provider"])
    cfg.add_argument("value", nargs="?")

    tools = sub.add_parser("tools", help="List or run built-in tools")
    tools.add_argument("action", nargs="?", choices=["list", "run"])
    tools.add_argument("name", nargs="?", help="Tool name (for 'run')")
    tools.add_argument("--args", help="Tool arguments as a JSON object (or pipe on stdin)")
    return parser


def _force_utf8_output() -> None:
    # Windows consoles default to cp1252 and choke on ✓/…/⚠. Force UTF-8 so
    # diagnostics render consistently across platforms.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (ValueError, OSError):
                pass


def main(argv: list[str] | None = None) -> int:
    _force_utf8_output()
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command or "status"
    handlers = {
        "version": cmd_version,
        "status": cmd_status,
        "doctor": cmd_doctor,
        "ask": cmd_ask,
        "chat": cmd_chat,
        "config": cmd_config,
        "tools": cmd_tools,
    }
    handler = handlers.get(command)
    if handler is None:
        parser.print_help()
        return 2
    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
