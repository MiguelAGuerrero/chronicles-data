/// <reference types="node" />
import { test } from 'node:test';

// Rebuild on push, fetch only what's stale (docs/spec.md, RB): one failing test per criterion, before its code.

test('RB1: the push trigger covers the code, the owner\'s files and the dependencies, and runs the tests first', { todo: 'test first' }, () => {});
test('RB2: each source\'s fetch has a fingerprint, recorded with the run that fetched it', { todo: 'test first' }, () => {});
test('RB3: a push fetches only stale sources and builds the others from their kept answers', { todo: 'test first' }, () => {});
test('RB4: the plan names the stale sources, and osmium is installed only when OpenStreetMap is one', { todo: 'test first' }, () => {});
test('RB5: an extract unchanged since the copy held is not downloaded, and its answers are carried', { todo: 'test first' }, () => {});
test('RB6: the weekly and hand runs fetch every source, as before', { todo: 'test first' }, () => {});
test('RB7: a complete run from before fingerprints is stale once', { todo: 'test first' }, () => {});
