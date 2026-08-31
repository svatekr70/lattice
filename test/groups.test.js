import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGroup, listGroups, groupItems } from '../src/util/groups.js';

test('normalizeGroup — ořízne a znormalizuje prázdnou', () => {
  assert.equal(normalizeGroup('  Prodeje '), 'Prodeje');
  assert.equal(normalizeGroup(''), '');
  assert.equal(normalizeGroup(null), '');
  assert.equal(normalizeGroup(undefined), '');
  assert.equal(normalizeGroup('   '), '');
});

test('listGroups — použité skupiny v pořadí prvního výskytu, bez duplicit', () => {
  const items = [
    { name: 'a' },
    { name: 'b', group: 'Prodeje' },
    { name: 'c', group: 'Faktury' },
    { name: 'd', group: ' Prodeje ' },
    { name: 'e', group: '  ' },
  ];
  assert.deepEqual(listGroups(items), ['Prodeje', 'Faktury']);
  assert.deepEqual(listGroups([]), []);
  assert.deepEqual(listGroups(undefined), []);
});

test('groupItems — nezařazené nahoře, pak skupiny v pořadí prvního výskytu', () => {
  const items = [
    { name: 'Vše' },
    { name: 'Prodeje dnes', group: 'Prodeje' },
    { name: 'Neuhrazené', group: 'Faktury' },
    { name: 'Bordel' },
    { name: 'Prodej včera', group: 'Prodeje' },
  ];
  const buckets = groupItems(items);
  assert.deepEqual(buckets.map((b) => b.group), ['', 'Prodeje', 'Faktury']);
  assert.deepEqual(buckets[0].items.map((i) => i.name), ['Vše', 'Bordel']);
  assert.deepEqual(buckets[1].items.map((i) => i.name), ['Prodeje dnes', 'Prodej včera']);
  assert.deepEqual(buckets[2].items.map((i) => i.name), ['Neuhrazené']);
});

test('groupItems — prázdný vstup i bez skupin', () => {
  assert.deepEqual(groupItems([]), []);
  const only = groupItems([{ name: 'a' }, { name: 'b' }]);
  assert.equal(only.length, 1);
  assert.equal(only[0].group, '');
});
