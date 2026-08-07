import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATE_PARTS, dateBucket } from '../src/core/dateParts.js';

// Lehký i18n stub — jen seznamy měsíců/dnů a týdenní popisek.
const i18n = {
  list: (k) => ({
    'dateRange.months': ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'],
    'dateRange.weekdaysLong': ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'],
  }[k] || []),
  t: (k) => (k === 'group.weekLabel' ? 'Týden' : k),
};

// 2026-03-17 je úterý, Q1, březen.
const d = '2026-03-17T14:05:00';

test('DATE_PARTS obsahuje všech 8 úrovní', () => {
  assert.deepEqual(DATE_PARTS, ['year', 'quarter', 'month', 'week', 'weekday', 'day', 'hour', 'minute']);
});

test('rok', () => assert.deepEqual(dateBucket(d, 'year', i18n), { sort: 2026, label: '2026' }));
test('kvartál (březen → Q1)', () => assert.deepEqual(dateBucket(d, 'quarter', i18n), { sort: 1, label: 'Q1' }));
test('měsíc (index 2 → Březen)', () => assert.deepEqual(dateBucket(d, 'month', i18n), { sort: 2, label: 'Březen' }));
test('den v týdnu (úterý, pondělí=0 → 1)', () => assert.deepEqual(dateBucket(d, 'weekday', i18n), { sort: 1, label: 'Úterý' }));
test('den v měsíci', () => assert.deepEqual(dateBucket(d, 'day', i18n), { sort: 17, label: '17.' }));
test('hodina', () => assert.deepEqual(dateBucket(d, 'hour', i18n), { sort: 14, label: '14:00' }));
test('minuta', () => assert.deepEqual(dateBucket(d, 'minute', i18n), { sort: 5, label: '14:05' }));

test('týden je číslo se štítkem', () => {
  const b = dateBucket(d, 'week', i18n);
  assert.equal(typeof b.sort, 'number');
  assert.match(b.label, /^Týden \d+$/);
});

test('neplatné datum → null', () => {
  assert.equal(dateBucket('', 'year', i18n), null);
  assert.equal(dateBucket(null, 'year', i18n), null);
  assert.equal(dateBucket('nesmysl', 'year', i18n), null);
});

test('neznámý part → null', () => assert.equal(dateBucket(d, 'decade', i18n), null));

test('kvartály přes rok mají rostoucí sort', () => {
  const q1 = dateBucket('2026-02-01', 'quarter', i18n).sort;
  const q4 = dateBucket('2026-11-01', 'quarter', i18n).sort;
  assert.ok(q1 < q4);
});

test('date-only string se bucketuje lokálně (shodně s Date objektem)', () => {
  // regrese: 'YYYY-MM-DD' se parsovalo jako UTC a lokální getter posunul den
  // v záporném UTC pásmu. Musí sedět s ekvivalentním lokálním Date objektem.
  for (const part of ['year', 'month', 'day']) {
    assert.deepEqual(
      dateBucket('2024-03-01', part, i18n),
      dateBucket(new Date(2024, 2, 1), part, i18n),
      `část ${part}`,
    );
  }
});
