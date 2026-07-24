import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runValidator } from '../src/features/editing.js';

const ok = (col, v, row) => assert.equal(runValidator(col, v, row, null), null);
const bad = (col, v, row) => assert.notEqual(runValidator(col, v, row, null), null);

test("validator 'required'", () => {
  ok({ validator: 'required' }, 'x');
  bad({ validator: 'required' }, '');
  bad({ validator: 'required' }, null);
});

test('validator {min,max}', () => {
  const col = { validator: { min: 0, max: 100 } };
  ok(col, 50); ok(col, 0); ok(col, 100);
  bad(col, -1); bad(col, 101);
  ok(col, ''); // prázdné neřeší (na to je required)
});

test('validator délka a pattern', () => {
  ok({ validator: { minLen: 2, maxLen: 5 } }, 'abc');
  bad({ validator: { minLen: 2 } }, 'a');
  bad({ validator: { maxLen: 3 } }, 'abcd');
  ok({ validator: /^[A-Z]+$/ }, 'ABC');
  bad({ validator: /^[A-Z]+$/ }, 'abc');
  ok({ validator: { pattern: '^\\d+$' } }, '123');
  bad({ validator: { pattern: '^\\d+$' } }, '12a');
});

test('validator funkce + vlastní hláška', () => {
  ok({ validator: (v) => v === 'ok' }, 'ok');
  assert.equal(runValidator({ validator: (v) => v === 'ok' ? true : 'špatně' }, 'ne', {}, null), 'špatně');
  assert.equal(runValidator({ validator: { required: true, message: 'nutné' } }, '', {}, null), 'nutné');
});

test('validator pole pravidel (řetězí se)', () => {
  const col = { validator: ['required', { maxLen: 3 }] };
  ok(col, 'ab');
  bad(col, '');       // required
  bad(col, 'abcd');   // maxLen
});
