import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDelimited, toJSON, toXML, buildExport } from '../src/core/exporter.js';

const cols = [{ field: 'id', title: 'ID' }, { field: 'name', title: 'Název' }, { field: 'budget', title: 'Rozpočet' }];
const rows = [
  { id: 1, name: 'Alice', budget: 1000 },
  { id: 2, name: 'Doe, John', budget: 2000 },      // čárka → uvozovky
  { id: 3, name: 'Say "hi"', budget: 3000 },        // uvozovky → zdvojení
];

test('CSV — čárka jako oddělovač, escapování', () => {
  const csv = toDelimited(rows, cols, { delimiter: ',' });
  const lines = csv.split('\n');
  assert.equal(lines[0], 'ID,Název,Rozpočet');
  assert.equal(lines[1], '1,Alice,1000');
  assert.equal(lines[2], '2,"Doe, John",2000');
  assert.equal(lines[3], '3,"Say ""hi""",3000');
});

test('CSV — středník / tabulátor jako oddělovač', () => {
  assert.equal(toDelimited(rows, cols, { delimiter: ';' }).split('\n')[1], '1;Alice;1000');
  assert.equal(toDelimited(rows, cols, { delimiter: '\t' }).split('\n')[1], '1\tAlice\t1000');
});

test('CSV — bez hlavičky', () => {
  const csv = toDelimited(rows, cols, { delimiter: ',', header: false });
  assert.equal(csv.split('\n')[0], '1,Alice,1000');
});

test('JSON — jen vybraná pole v pořadí sloupců', () => {
  const data = JSON.parse(toJSON(rows, [{ field: 'id' }, { field: 'name' }]));
  assert.deepEqual(data[0], { id: 1, name: 'Alice' });
  assert.equal('budget' in data[0], false);
});

test('XML — element na pole, escapování', () => {
  const xml = toXML([{ id: 1, name: 'A & B <x>' }], [{ field: 'id' }, { field: 'name' }]);
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<row><id>1<\/id><name>A &amp; B &lt;x&gt;<\/name><\/row>/);
});

test('buildExport — přepínání formátů + tsv default oddělovač', () => {
  assert.equal(buildExport('tsv', rows, cols).split('\n')[1], '1\tAlice\t1000');
  assert.match(buildExport('xml', rows, cols), /^<\?xml/);
  assert.equal(JSON.parse(buildExport('json', rows, cols)).length, 3);
});

/* ---- computed sloupce + Excel (SpreadsheetML) ---- */
import { toExcelXML } from '../src/core/exporter.js';

test('export: computed sloupec (col.value) do CSV/JSON', () => {
  const c = [{ field: 'a', title: 'A' }, { field: 'sum', title: 'Součet', type: 'number', value: (r) => r.a + r.b }];
  const rs = [{ a: 2, b: 3 }, { a: 10, b: 1 }];
  assert.equal(toDelimited(rs, c, { delimiter: ',' }).split('\n')[1], '2,5');
  assert.equal(JSON.parse(toJSON(rs, c))[1].sum, 11);
});

test('Excel: čísla jako Number, text jako String, computed funguje', () => {
  const c = [{ field: 'name', title: 'Název' }, { field: 'budget', title: 'Rozpočet', type: 'money' }, { field: 'x2', title: '2×', type: 'number', value: (r) => r.budget * 2 }];
  const rs = [{ name: 'Alice', budget: 1000 }];
  const xml = toExcelXML(rs, c);
  assert.match(xml, /mso-application progid="Excel.Sheet"/);
  assert.match(xml, /<Data ss:Type="String">Alice<\/Data>/);
  assert.match(xml, /<Data ss:Type="Number">1000<\/Data>/);
  assert.match(xml, /<Data ss:Type="Number">2000<\/Data>/); // computed 1000*2
});

test('Excel: buildExport přes formát "excel"', () => {
  const c = [{ field: 'id', title: 'ID', type: 'number' }];
  assert.match(buildExport('excel', [{ id: 7 }], c), /<Data ss:Type="Number">7<\/Data>/);
});

/* ------------------------- CSV/formula-injection ------------------------- */

test('CSV: hodnoty začínající =,+,-,@ (vzorec) se neutralizují apostrofem', () => {
  const c = [{ field: 'v', title: 'V' }];
  const line = (val) => toDelimited([{ v: val }], c, { delimiter: ',', header: false });
  assert.equal(line('=1+2'), "'=1+2");
  assert.equal(line('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"'); // + uvozovkování
  assert.equal(line('+CMD'), "'+CMD");
  assert.equal(line('@SUM'), "'@SUM");
  assert.equal(line('-2+3'), "'-2+3", 'vzorec začínající - se také neutralizuje');
});

test('CSV: obyčejná čísla (i záporná) zůstanou beze změny', () => {
  const c = [{ field: 'v', title: 'V' }];
  const line = (val) => toDelimited([{ v: val }], c, { delimiter: ',', header: false });
  assert.equal(line(-5), '-5', 'záporné číslo zůstane číslem');
  assert.equal(line('-5'), '-5');
  assert.equal(line('-5.5'), '-5.5');
  assert.equal(line(42), '42');
  assert.equal(line('běžný text'), 'běžný text');
});
