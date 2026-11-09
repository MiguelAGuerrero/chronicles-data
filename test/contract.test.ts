/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contractFiles } from '../src/contract';

// The contract (decision 0108 in the app repo): what the app may rely on is what the code says, committed.
const ROOT = join(fileURLToPath(import.meta.url), '../..');

test('CT1: contract/ is exactly what the code generates (run `npm run contract` after a change)', async () => {
  for (const [path, body] of await contractFiles()) {
    assert.ok(readFileSync(join(ROOT, 'contract', path)).equals(Buffer.from(body)), `contract/${path} is current`);
  }
});

test('CT2: the example manifest names its file, version, bounds and blocks as manifest.schema.json says', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'contract/example/manifest.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(join(ROOT, 'contract/manifest.schema.json'), 'utf8'));
  assert.equal(m.schema, 1);
  const file = new RegExp(schema.$defs.file.properties.file.pattern);
  for (const r of m.regions) {
    for (const f of [r.current, ...r.previous]) {
      assert.match(f.file, file);
      assert.equal(f.bounds.length, 4);
      for (const [k, v] of Object.entries(f.blocks ?? {})) {
        assert.match(k, new RegExp(schema.$defs.file.properties.blocks.propertyNames.pattern));
        assert.match(String(v), new RegExp(schema.$defs.file.properties.blocks.additionalProperties.pattern));
      }
    }
  }
});
