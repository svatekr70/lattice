import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TreeManager } from '../src/features/tree.js';

const fakeGrid = () => ({ state: { tree: [] }, saveState() {}, refresh() {} });

test('nested set (lft/rgt) → rekonstrukce stromu + hloubky', () => {
  // root[1..8] { a[2..5] { a1[3..4] }, b[6..7] }
  const data = [
    { id: 1, name: 'root', lft: 1, rgt: 8 },
    { id: 2, name: 'a', lft: 2, rgt: 5 },
    { id: 3, name: 'a1', lft: 3, rgt: 4 },
    { id: 4, name: 'b', lft: 6, rgt: 7 },
  ];
  const tm = new TreeManager(fakeGrid(), {
    data, treeLeftField: 'lft', treeRightField: 'rgt', treeIdField: 'id', treeStartExpanded: true,
  });

  assert.equal(tm.roots.length, 1);
  const root = tm.roots[0];
  assert.equal(root.row.name, 'root');
  assert.equal(root.depth, 0);
  assert.deepEqual(root.children.map((c) => c.row.name), ['a', 'b']);
  assert.equal(root.children[0].depth, 1);
  assert.equal(root.children[0].children[0].row.name, 'a1');
  assert.equal(root.children[0].children[0].depth, 2);
  // vše rozbalené → 4 viditelné řádky v preorder pořadí
  assert.deepEqual(tm.visibleRows().map((v) => v.row.name), ['root', 'a', 'a1', 'b']);
});

test('nested set — dva kořeny, nesetříděný vstup', () => {
  const data = [
    { name: 'r2', lft: 5, rgt: 6 },
    { name: 'r1', lft: 1, rgt: 4 },
    { name: 'c', lft: 2, rgt: 3 },
  ];
  const tm = new TreeManager(fakeGrid(), { data, treeLeftField: 'lft', treeRightField: 'rgt', treeStartExpanded: true });
  assert.deepEqual(tm.roots.map((r) => r.row.name), ['r1', 'r2']);
  assert.equal(tm.roots[0].children[0].row.name, 'c');
  assert.deepEqual(tm.visibleRows().map((v) => v.row.name), ['r1', 'c', 'r2']);
});

test('moveNode — nested set: přesun uzlu s podstromem přečísluje lft/rgt', () => {
  // root[1..8] { a[2..5]{a1[3..4]}, b[6..7] }  → přesuň a1 pod b
  const data = [
    { id: 1, name: 'root', lft: 1, rgt: 8 },
    { id: 2, name: 'a', lft: 2, rgt: 5 },
    { id: 3, name: 'a1', lft: 3, rgt: 4 },
    { id: 4, name: 'b', lft: 6, rgt: 7 },
  ];
  const tm = new TreeManager(fakeGrid(), { data, treeLeftField: 'lft', treeRightField: 'rgt', treeIdField: 'id', treeStartExpanded: true });
  const res = tm.moveNode('3', '4', 'inside'); // a1 → dovnitř b
  assert.ok(res);
  // strom: root{ a{}, b{ a1 } }
  const byId = Object.fromEntries(data.map((r) => [r.id, r]));
  assert.equal(byId[2].lft, 2); assert.equal(byId[2].rgt, 3); // a je teď list
  assert.equal(byId[4].lft, 4); assert.equal(byId[4].rgt, 7); // b obklopuje a1
  assert.equal(byId[3].lft, 5); assert.equal(byId[3].rgt, 6); // a1 uvnitř b
  assert.equal(byId[1].lft, 1); assert.equal(byId[1].rgt, 8); // root beze změny rozsahu
});

test('moveNode — flat parentId: reparent přepíše parentId', () => {
  const data = [
    { id: 1, name: 'root', parentId: null },
    { id: 2, name: 'a', parentId: 1 },
    { id: 3, name: 'a1', parentId: 2 },
    { id: 4, name: 'b', parentId: 1 },
  ];
  const tm = new TreeManager(fakeGrid(), { data, treeIdField: 'id', treeParentField: 'parentId', treeStartExpanded: true });
  const res = tm.moveNode('3', '4', 'inside'); // a1 → pod b
  assert.ok(res);
  assert.equal(data.find((r) => r.id === 3).parentId, 4);
  assert.equal(res.toParentId, 4);
  assert.ok(res.changed.includes(data.find((r) => r.id === 3)));
});

test('moveNode — nelze přesunout uzel do vlastního potomka', () => {
  const data = [
    { id: 1, name: 'root', parentId: null },
    { id: 2, name: 'a', parentId: 1 },
    { id: 3, name: 'a1', parentId: 2 },
  ];
  const tm = new TreeManager(fakeGrid(), { data, treeIdField: 'id', treeParentField: 'parentId', treeStartExpanded: true });
  assert.equal(tm.moveNode('1', '3', 'inside'), null); // root do svého potomka → zamítnuto
});

test('moveNode — _children: přesun přepíše childField pole', () => {
  const a1 = { id: 3, name: 'a1' };
  const a = { id: 2, name: 'a', _children: [a1] };
  const b = { id: 4, name: 'b', _children: [] };
  const root = { id: 1, name: 'root', _children: [a, b] };
  const tm = new TreeManager(fakeGrid(), { data: [root], treeIdField: 'id', treeStartExpanded: true });
  const res = tm.moveNode('3', '4', 'inside'); // a1 → pod b
  assert.ok(res);
  assert.deepEqual(a._children, []);
  assert.equal(b._children.length, 1);
  assert.equal(b._children[0].id, 3);
});

test('expandToLevel — rovnoměrné rozbalení do úrovně', () => {
  const data = [
    { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 },
  ];
  const tm = new TreeManager(fakeGrid(), { data, treeIdField: 'id', treeParentField: 'parentId' });
  assert.equal(tm.depthMax, 2);
  tm.expandToLevel(0); assert.equal(tm.visibleRows().length, 1); // jen kořen
  tm.expandToLevel(1); assert.equal(tm.visibleRows().length, 2); // + 1 úroveň
  tm.expandToLevel(2); assert.equal(tm.visibleRows().length, 3); // vše
  tm.collapseAll(); assert.equal(tm.visibleRows().length, 1);
  tm.expandAll(); assert.equal(tm.visibleRows().length, 3);
});

test('toggle — sbalení zapomene podstrom (po rozbalení jsou vnořené sbalené)', () => {
  const data = [{ id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }];
  const tm = new TreeManager(fakeGrid(), { data, treeIdField: 'id', treeParentField: 'parentId', treeStartExpanded: true });
  assert.ok(tm.isExpanded('1') && tm.isExpanded('2'));
  tm.toggle('1'); // sbal kořen → zapomene i '2'
  assert.ok(!tm.isExpanded('1') && !tm.isExpanded('2'));
  tm.toggle('1'); // znovu rozbal → '2' zůstane sbalené
  assert.ok(tm.isExpanded('1') && !tm.isExpanded('2'));
});
