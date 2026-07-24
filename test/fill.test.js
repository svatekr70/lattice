import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillSequence } from '../src/features/rangeSelection.js';

test('fill: číselná posloupnost pokračuje', () => {
  assert.equal(fillSequence([1, 2], 2), 3);
  assert.equal(fillSequence([1, 2], 3), 4);
  assert.equal(fillSequence([0, 10], 3), 30);
  assert.equal(fillSequence([5], 1), 5);   // jediná hodnota → kopíruje
  assert.equal(fillSequence([5], 4), 5);
});

test('fill: cyklické kopírování textu', () => {
  assert.equal(fillSequence(['A', 'B'], 2), 'A');
  assert.equal(fillSequence(['A', 'B'], 3), 'B');
  assert.equal(fillSequence(['X'], 5), 'X');
});

test('fill: datumová posloupnost (+krok dní)', () => {
  assert.equal(fillSequence(['2026-03-01', '2026-03-02'], 2), '2026-03-03');
  assert.equal(fillSequence(['2026-03-01', '2026-03-08'], 2), '2026-03-15'); // +7 dní
  assert.equal(fillSequence(['2026-03-01'], 3), '2026-03-01'); // jediné datum → kopie
});
