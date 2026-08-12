from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from agent_studio.llm.types import ChatMessage
from agent_studio.memory.export import conversation_to_markdown, default_export_filename
from agent_studio.memory.store import ConversationStore


class StoreTests(unittest.TestCase):
    def test_save_load_roundtrip_matches_ts_schema(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d))
            conv = store.create(provider_id="nvidia", model="m")
            store.append(conv, ChatMessage("user", "Hello"))
            store.append(conv, ChatMessage("assistant", "Hi!"))
            path = store.save(conv)
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
            # Same on-disk shape as the TS engine (camelCase keys).
            self.assertEqual(raw["schemaVersion"], 1)
            self.assertEqual(raw["providerId"], "nvidia")
            self.assertEqual(raw["messages"][0], {"role": "user", "content": "Hello"})
            self.assertEqual(store.load(conv.id).title, "Hello")  # derived from first user msg

    def test_ephemeral_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d), ephemeral=True)
            conv = store.create()
            store.append(conv, ChatMessage("user", "secret"))
            self.assertEqual(store.save(conv), "")
            self.assertEqual(store.list(), [])

    def test_rename_search_delete(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d))
            a = store.create(title="Deploy runbook")
            store.append(a, ChatMessage("user", "roll back a Kubernetes deployment"))
            store.save(a)
            b = store.create(title="Cooking")
            store.append(b, ChatMessage("user", "pasta recipe"))
            store.save(b)

            store.rename(a.id, "  K8s notes  ")
            self.assertEqual(store.load(a.id).title, "K8s notes")

            by_msg = store.search("kubernetes")
            self.assertEqual(len(by_msg), 1)
            self.assertEqual(by_msg[0].matched_in, "message")
            self.assertIn("Kubernetes", by_msg[0].snippet)

            self.assertEqual(len(store.search("cooking")), 1)
            self.assertEqual(store.search("   "), [])

            self.assertTrue(store.delete(b.id))
            self.assertIsNone(store.try_load(b.id))

    def test_rejects_bad_id(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d))
            with self.assertRaises(ValueError):
                store._path("../escape")  # noqa: SLF001


class RobustnessTests(unittest.TestCase):
    def test_save_is_atomic_no_temp_left_behind(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d))
            conv = store.create(provider_id="nvidia", model="m")
            store.append(conv, ChatMessage("user", "hi"))
            store.save(conv)
            files = list((Path(d) / "conversations").iterdir())
            # Only the final .json remains (no leftover temp files).
            self.assertEqual([f.name for f in files], [f"{conv.id}.json"])

    def test_corrupt_file_is_surfaced_not_silently_dropped(self) -> None:
        import io
        from contextlib import redirect_stderr

        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d))
            good = store.create()
            store.append(good, ChatMessage("user", "ok"))
            store.save(good)
            # Write a corrupt conversation file alongside the good one.
            (Path(d) / "conversations" / "deadbeef.json").write_text("{ not json", encoding="utf-8")

            buf = io.StringIO()
            with redirect_stderr(buf):
                summaries = store.list()
            self.assertEqual(len(summaries), 1)  # good one still listed
            self.assertIn("unreadable", buf.getvalue().lower())
            # The corrupt file is kept (not deleted).
            self.assertTrue((Path(d) / "conversations" / "deadbeef.json").exists())


class ExportTests(unittest.TestCase):
    def test_markdown_and_filename(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            store = ConversationStore(data_dir=Path(d))
            conv = store.create(provider_id="nvidia", model="test-model", title="Chat A")
            store.append(conv, ChatMessage("user", "ping"))
            store.append(conv, ChatMessage("assistant", "pong"))
            md = conversation_to_markdown(conv)
            self.assertTrue(md.startswith("# Chat A"))
            self.assertIn("- Model: test-model", md)
            self.assertIn("### You\n\nping", md)
            self.assertIn("### Assistant\n\npong", md)
            self.assertRegex(default_export_filename(conv), r"^chat-a-[0-9a-f]{8}\.md$")


if __name__ == "__main__":
    unittest.main()
