import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { JsonParseError, parseJson, readJsonFile, stripBom } from './jsonFile.ts';

test('stripBom: removes a leading UTF-8 BOM, leaves other text alone', () => {
  assert.equal(stripBom('\uFEFF{"a":1}'), '{"a":1}');
  assert.equal(stripBom('{"a":1}'), '{"a":1}');
  assert.equal(stripBom(''), '');
});

test('parseJson: parses BOM-prefixed JSON without error', () => {
  const value = parseJson('\uFEFF{"hello":"world"}', 'mem') as { hello: string };
  assert.equal(value.hello, 'world');
});

test('parseJson: throws a clear JsonParseError (with path) on bad JSON', () => {
  assert.throws(
    () => parseJson('{ not: valid, }', '/tmp/bad.json'),
    (err: unknown) =>
      err instanceof JsonParseError &&
      err.path === '/tmp/bad.json' &&
      /Could not parse JSON/.test(err.message) &&
      /BOM/.test(err.message),
  );
});

test('readJsonFile: reads and strips a BOM from a real file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-json-'));
  try {
    const p = join(dir, 'x.json');
    writeFileSync(p, '\uFEFF{"ok":true}', 'utf8');
    const value = readJsonFile(p) as { ok: boolean };
    assert.equal(value.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
