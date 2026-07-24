/**
 * Ukázková organizační struktura pro Tree demo. Jeden zdroj pravdy (plochý
 * seznam s parentId) → z něj se odvodí i zanořená varianta (_children), takže
 * obě ukázky zobrazují TÝŽ strom, jen v jiném vstupním formátu.
 */

// Plochý seznam: každý zaměstnanec má id a odkaz na nadřízeného (parentId).
const FLAT = [
  { id: 1,  parentId: null, name: 'Alena Nováková',    role: 'CEO',                dept: 'Vedení',    location: 'Praha',   employees: 48 },
  { id: 2,  parentId: 1,    name: 'Petr Svoboda',      role: 'CTO',                dept: 'Technologie', location: 'Praha', employees: 21 },
  { id: 3,  parentId: 1,    name: 'Jana Kučerová',     role: 'CFO',                dept: 'Finance',   location: 'Brno',    employees: 7 },
  { id: 4,  parentId: 1,    name: 'Marek Dvořák',      role: 'CMO',                dept: 'Marketing', location: 'Praha',   employees: 12 },
  { id: 5,  parentId: 2,    name: 'Lucie Horáková',    role: 'Vedoucí backendu',   dept: 'Technologie', location: 'Praha', employees: 6 },
  { id: 6,  parentId: 2,    name: 'Tomáš Beneš',       role: 'Vedoucí frontendu',  dept: 'Technologie', location: 'Ostrava', employees: 5 },
  { id: 7,  parentId: 5,    name: 'David Král',        role: 'Senior vývojář',     dept: 'Technologie', location: 'Praha',   employees: 0 },
  { id: 8,  parentId: 5,    name: 'Eva Pokorná',       role: 'Vývojářka',          dept: 'Technologie', location: 'Praha',   employees: 0 },
  { id: 9,  parentId: 6,    name: 'Filip Němec',       role: 'Vývojář',            dept: 'Technologie', location: 'Ostrava', employees: 0 },
  { id: 10, parentId: 6,    name: 'Klára Marková',     role: 'UX designérka',      dept: 'Technologie', location: 'Ostrava', employees: 0 },
  { id: 11, parentId: 3,    name: 'Ondřej Zeman',      role: 'Hlavní účetní',      dept: 'Finance',   location: 'Brno',    employees: 2 },
  { id: 12, parentId: 11,   name: 'Petra Sedláčková',  role: 'Účetní',             dept: 'Finance',   location: 'Brno',    employees: 0 },
  { id: 13, parentId: 4,    name: 'Martin Urban',      role: 'Vedoucí kampaní',    dept: 'Marketing', location: 'Praha',   employees: 4 },
  { id: 14, parentId: 13,   name: 'Nikola Fialová',    role: 'Specialistka PPC',   dept: 'Marketing', location: 'Praha',   employees: 0 },
  { id: 15, parentId: 13,   name: 'Jakub Růžička',     role: 'Content specialista', dept: 'Marketing', location: 'Brno',   employees: 0 },
];

/** Plochá varianta (id + parentId) — knihovna si strom sestaví sama. */
export function orgFlat() {
  return FLAT.map((r) => ({ ...r }));
}

/** Zanořená varianta (_children) — odvozená z ploché, stejný strom. */
export function orgNested() {
  const byId = new Map();
  const roots = [];
  for (const r of FLAT) byId.set(r.id, { ...r, _children: [] });
  for (const r of FLAT) {
    const node = byId.get(r.id);
    if (r.parentId == null) roots.push(node);
    else byId.get(r.parentId)._children.push(node);
  }
  // parentId v zanořené variantě nepotřebujeme — hierarchii nese _children
  const strip = (n) => { const { parentId, ...rest } = n; rest._children = rest._children.map(strip); return rest; };
  return roots.map(strip);
}

/**
 * Nested set (MPTT) varianta — týž strom, ale místo parentId nese každý záznam
 * `lft`/`rgt` z obcházení stromu (preorder). Spočítá se z FLAT přes DFS.
 */
export function orgNestedSet() {
  const childrenOf = {};
  for (const r of FLAT) {
    const key = r.parentId == null ? 'root' : r.parentId;
    (childrenOf[key] || (childrenOf[key] = [])).push(r);
  }
  const out = [];
  let counter = 1;
  const visit = (node) => {
    const lft = counter++;
    for (const kid of childrenOf[node.id] || []) visit(kid);
    const rgt = counter++;
    const { parentId, ...rest } = node;
    out.push({ ...rest, lft, rgt });
  };
  for (const root of childrenOf.root || []) visit(root);
  return out.sort((a, b) => a.lft - b.lft);
}

/** Sloupce pro org strukturu (první sloupec = jméno nese strom). */
export function orgColumns() {
  return [
    { field: 'name',      title: 'Jméno',        type: 'text',   width: 240 },
    { field: 'role',      title: 'Pozice',       type: 'text',   width: 190 },
    { field: 'dept',      title: 'Oddělení',     type: 'text',   width: 140 },
    { field: 'location',  title: 'Lokalita',     type: 'text',   width: 120 },
    { field: 'employees', title: 'Podřízených',  type: 'number', width: 120, align: 'right' },
  ];
}

/** Sloupce pro nested-set variantu — navíc ukazují lft/rgt hodnoty. */
export function orgColumnsNS() {
  return [
    { field: 'name',     title: 'Jméno',    type: 'text',   width: 240 },
    { field: 'role',     title: 'Pozice',   type: 'text',   width: 190 },
    { field: 'dept',     title: 'Oddělení', type: 'text',   width: 140 },
    { field: 'lft',      title: 'lft',      type: 'number', width: 70, align: 'right' },
    { field: 'rgt',      title: 'rgt',      type: 'number', width: 70, align: 'right' },
  ];
}
