import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPS, normalizeTips, availableTips, pickTip } from '../src/features/tips.js';
import { I18n } from '../src/i18n/index.js';
import cs from '../src/i18n/cs.js';
import en from '../src/i18n/en.js';
import pl from '../src/i18n/pl.js';
import sk from '../src/i18n/sk.js';

/** Minimální fake grid — tipy sahají jen na options/columns/instance/i18n. */
function fakeGrid(options = {}, columns = [{ field: 'a', filter: 'text', type: 'text' }]) {
  const grid = { options: { tips: true, ...options }, columns, instance: {}, i18n: new I18n('cs') };
  grid.tips = normalizeTips(grid.options.tips);
  return grid;
}

test('normalizeTips — true / false / objekt', () => {
  assert.deepEqual(normalizeTips(true), { enabled: true, builtin: true, extra: [] });
  assert.equal(normalizeTips(false).enabled, false);
  assert.equal(normalizeTips(undefined).enabled, false);
  const cfg = normalizeTips({ extra: ['Vlastní tip', '  ', ''], builtin: false });
  assert.equal(cfg.enabled, true, 'objekt bez enabled = zapnuto');
  assert.equal(cfg.builtin, false);
  assert.deepEqual(cfg.extra, ['Vlastní tip'], 'prázdné vlastní tipy vypadnou');
});

test('vypnuté tipy nic nenabídnou', () => {
  assert.deepEqual(availableTips(fakeGrid({ tips: false })), []);
  assert.equal(pickTip(fakeGrid({ tips: false })), '');
});

test('vestavěné tipy se přeloží a vyfiltrují podle funkcí gridu', () => {
  const plain = availableTips(fakeGrid());
  assert.ok(plain.length > 40, 'běžný grid nabídne desítky tipů');
  assert.ok(plain.every((x) => typeof x === 'string' && x && !x.startsWith('tips.')), 'žádný nepřeložený klíč');

  // tip o stromu se ukáže jen ve stromovém gridu
  const treeTip = cs.tips.list.tree;
  assert.ok(!plain.includes(treeTip));
  const withTree = fakeGrid();
  withTree.tree = {};
  assert.ok(availableTips(withTree).includes(treeTip));

  // bez datumového sloupce nemá smysl radit s dynamickým datumovým filtrem
  assert.ok(!plain.includes(cs.tips.list.filterDynamic));
  const withDate = fakeGrid({}, [{ field: 'd', filter: 'date-range', type: 'date' }]);
  assert.ok(availableTips(withDate).includes(cs.tips.list.filterDynamic));

  // vypnutá funkce v aplikaci → tipy k ní zmizí
  const noGear = availableTips(fakeGrid({ features: { gear: false } }));
  assert.ok(!noGear.includes(cs.tips.list.freeze));
  assert.ok(noGear.includes(cs.tips.list.sort), 'tipy nezávislé na dialogu zůstávají');
});

test('vlastní tipy aplikace se přidají (a builtin:false nechá jen je)', () => {
  const both = availableTips(fakeGrid({ tips: { extra: ['Interní tip'] } }));
  assert.ok(both.includes('Interní tip'));
  assert.ok(both.length > 1);
  const onlyOwn = availableTips(fakeGrid({ tips: { builtin: false, extra: ['Interní tip'] } }));
  assert.deepEqual(onlyOwn, ['Interní tip']);
});

test('pickTip vybírá z nabídky a neopakuje právě zobrazený', () => {
  const grid = fakeGrid();
  const list = availableTips(grid);
  for (let i = 0; i < 50; i++) {
    const shown = list[i % list.length];
    const next = pickTip(grid, shown);
    assert.ok(list.includes(next));
    assert.notEqual(next, shown, 'další tip je vždy jiný, dokud je z čeho vybírat');
  }
  // jediný tip se opakovat musí (jinak by nebylo co ukázat)
  const one = fakeGrid({ tips: { builtin: false, extra: ['Jediný'] } });
  assert.equal(pickTip(one, 'Jediný'), 'Jediný');
});

test('všechny jazyky mají texty ke všem tipům (a nic navíc)', () => {
  const ids = TIPS.map((x) => x.id).sort();
  assert.equal(new Set(ids).size, ids.length, 'id tipů jsou unikátní');
  for (const [lang, dict] of Object.entries({ cs, en, pl, sk })) {
    const keys = Object.keys(dict.tips.list).sort();
    assert.deepEqual(keys, ids, `slovník ${lang} odpovídá katalogu tipů`);
    for (const [id, text] of Object.entries(dict.tips.list)) {
      assert.ok(text && text.trim(), `${lang}.${id} není prázdný`);
      assert.ok(!/[\r\n]/.test(text), `${lang}.${id} je jednořádkový`);
      assert.ok(text.length <= 130, `${lang}.${id} se vejde do jednoho řádku (má ${text.length} znaků)`);
    }
    for (const key of ['label', 'next', 'hide']) assert.ok(dict.tips[key], `${lang}.tips.${key}`);
    assert.ok(dict.instance.showTips, `${lang}.instance.showTips`);
  }
});
