from __future__ import annotations

import io
import json
import unittest

from agent_studio.rpc.host import handle_request, serve
from agent_studio.tools.registry import default_registry


class HandleRequestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.reg = default_registry()

    def test_ping(self) -> None:
        resp = handle_request({"jsonrpc": "2.0", "id": 1, "method": "ping"}, self.reg)
        self.assertEqual(resp["id"], 1)
        self.assertTrue(resp["result"]["ok"])
        self.assertIn("version", resp["result"])

    def test_tools_list(self) -> None:
        resp = handle_request({"id": 2, "method": "tools/list"}, self.reg)
        names = [t["name"] for t in resp["result"]["tools"]]
        self.assertIn("text.stats", names)

    def test_tools_call(self) -> None:
        resp = handle_request(
            {"id": 3, "method": "tools/call", "params": {"name": "text.stats", "arguments": {"text": "a b c"}}},
            self.reg,
        )
        self.assertEqual(resp["result"]["words"], 3)

    def test_tool_error_maps_to_json_rpc_error(self) -> None:
        resp = handle_request(
            {"id": 4, "method": "tools/call", "params": {"name": "nope", "arguments": {}}}, self.reg
        )
        self.assertEqual(resp["error"]["code"], -32000)

    def test_unknown_method(self) -> None:
        resp = handle_request({"id": 5, "method": "frobnicate"}, self.reg)
        self.assertEqual(resp["error"]["code"], -32601)

    def test_notification_has_no_response(self) -> None:
        self.assertIsNone(handle_request({"method": "ping"}, self.reg))


class ServeTests(unittest.TestCase):
    def test_serve_reads_and_writes_ndjson(self) -> None:
        stdin = io.StringIO(
            "\n".join(
                [
                    json.dumps({"id": 1, "method": "ping"}),
                    json.dumps({"id": 2, "method": "tools/call", "params": {"name": "diff.unified", "arguments": {"a": "x\n", "b": "y\n"}}}),
                    "",
                ]
            )
        )
        stdout = io.StringIO()
        serve(stdin=stdin, stdout=stdout, registry=default_registry())
        lines = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual(lines[0]["id"], 1)
        self.assertTrue(lines[0]["result"]["ok"])
        self.assertEqual(lines[1]["id"], 2)
        self.assertTrue(lines[1]["result"]["changed"])


if __name__ == "__main__":
    unittest.main()
