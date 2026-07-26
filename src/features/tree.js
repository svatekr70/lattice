/**
 * TreeManager — hierarchická data (dataTree). Na rozdíl od
 * seskupení řádků (row grouping), kde jsou hlavičky syntetické, je tu každý
 * řádek SKUTEČNÝ datový záznam, který může mít potomky stejného tvaru
 * (např. organizační struktura: nadřízený → podřízení).
 *
 * Podporuje TŘI formáty vstupu (knihovní feature, zdroj dat je jedno):
 *   1) zanořený:  každý záznam má pole potomků (default `_children`),
 *   2) plochý:    každý záznam má vlastní `id` a odkaz na nadřízeného `parentId`,
 *   3) nested set (MPTT): každý záznam má `lft`/`rgt` z obcházení stromu; potomci
 *                 jsou záznamy, jejichž interval [lft,rgt] leží uvnitř rodiče.
 *
 * Stav rozbalení uzlů se persistuje (klíče uzlů) v blobu pod `tree`.
 */
export class TreeManager {
  constructor(grid, options) {
    this.grid = grid;
    this.childField = options.treeChildField || '_children';
    this.idField = options.treeIdField || null;
    this.parentField = options.treeParentField || null;
    this.leftField = options.treeLeftField || null;   // nested set (MPTT) — levá hranice
    this.rightField = options.treeRightField || null; // nested set (MPTT) — pravá hranice
    this.orderField = options.orderField || null;     // pole pořadí sourozenců (u parentId)
    this.format = 'nested';                            // 'nested' | 'flat' | 'nested-set' (dle vstupu)
    // true = rozbalit vše, číslo = do dané hloubky, false = sbaleno (default)
    this.startExpanded = options.treeStartExpanded != null ? options.treeStartExpanded : false;
    this.expanded = new Set(grid.state.tree || []);
    this._seeded = (grid.state.tree || []).length > 0;
    this.setData(options.data || []);
  }

  /** Přenačte data a přestaví strom (zachová stav rozbalení dle klíčů). */
  setData(data) {
    const arr = Array.isArray(data) ? data : [];
    const nested = arr.some((r) => Array.isArray(r[this.childField]));
    if (nested) { this.format = 'nested'; this.roots = this.buildNested(arr, '', 0); }
    else if (this.leftField && this.rightField) { this.format = 'nested-set'; this.roots = this.buildNestedSet(arr); }
    else if (this.idField && this.parentField) { this.format = 'flat'; this.roots = this.buildFlat(arr); }
    else { this.format = 'nested'; this.roots = this.buildNested(arr, '', 0); }
    this.computeDepthMax();
    if (!this._seeded) { this.seedExpanded(this.roots); this._seeded = true; }
    // Rovnoměrná úroveň pro krokování (± úroveň) — odvozená z startExpanded.
    this.level = this.startExpanded === true ? this.depthMax
      : (typeof this.startExpanded === 'number' ? Math.min(this.startExpanded, this.depthMax) : 0);
  }

  /** Klíč uzlu — stabilní `id` když je k dispozici, jinak cesta parent/index. */
  nodeKey(row, parentKey, index) {
    if (this.idField && row[this.idField] != null) return String(row[this.idField]);
    return parentKey ? parentKey + '/' + index : '#' + index;
  }

  buildNested(arr, parentKey, depth) {
    return arr.map((row, i) => {
      const key = this.nodeKey(row, parentKey, i);
      const kids = Array.isArray(row[this.childField]) ? row[this.childField] : [];
      return { row, key, depth, children: this.buildNested(kids, key, depth + 1) };
    });
  }

  buildFlat(arr) {
    const byId = new Map();
    const nodes = arr.map((row) => ({ row, key: String(row[this.idField]), depth: 0, children: [] }));
    for (const n of nodes) byId.set(n.key, n);
    const roots = [];
    for (const n of nodes) {
      const pid = n.row[this.parentField];
      const parent = pid != null && pid !== '' ? byId.get(String(pid)) : null;
      if (parent && parent !== n) parent.children.push(n);
      else roots.push(n);
    }
    const setDepth = (n, d) => { n.depth = d; for (const c of n.children) setDepth(c, d + 1); };
    for (const r of roots) setDepth(r, 0);
    return roots;
  }

  /**
   * Nested set (MPTT): uzly seřadí dle `lft` a zásobníkem předků sestaví strom.
   * Rodič uzlu je poslední otevřený předek (rgt > rgt uzlu). Hloubka = velikost
   * zásobníku předků. Klíč = id (když je), jinak lft (unikátní).
   */
  buildNestedSet(arr) {
    const L = this.leftField, R = this.rightField;
    const nodes = arr
      .filter((row) => row && row[L] != null && row[R] != null)
      .map((row) => ({
        row,
        key: this.idField && row[this.idField] != null ? String(row[this.idField]) : String(row[L]),
        depth: 0,
        children: [],
      }));
    nodes.sort((a, b) => a.row[L] - b.row[L]);
    const roots = [];
    const stack = [];
    for (const n of nodes) {
      while (stack.length && stack[stack.length - 1].row[R] < n.row[R]) stack.pop();
      n.depth = stack.length;
      if (stack.length) stack[stack.length - 1].children.push(n);
      else roots.push(n);
      stack.push(n);
    }
    return roots;
  }

  /** Prvotní naplnění rozbalených uzlů dle startExpanded (jen bez persistence). */
  seedExpanded(nodes) {
    const limit = this.startExpanded === true ? Infinity
      : (typeof this.startExpanded === 'number' ? this.startExpanded : 0);
    const walk = (list) => {
      for (const n of list) {
        if (n.depth < limit && n.children.length) this.expanded.add(n.key);
        walk(n.children);
      }
    };
    walk(nodes);
  }

  /** Ploché pořadí viditelných řádků (preorder; potomci jen u rozbalených uzlů). */
  visibleRows() {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        const hasChildren = n.children.length > 0;
        const expanded = this.expanded.has(n.key);
        out.push({ row: n.row, depth: n.depth, hasChildren, expanded, key: n.key });
        if (hasChildren && expanded) walk(n.children);
      }
    };
    walk(this.roots);
    return out;
  }

  /**
   * Viditelné řádky s aplikovaným filtrem. Uzel se zobrazí, pokud sám vyhovuje
   * `predicate`, nebo má vyhovujícího potomka (zachová cestu k shodě). Větve se
   * shodou se automaticky rozbalí, ať jsou nálezy vidět. Bez shody → prázdno.
   */
  filteredRows(predicate) {
    const rec = (nodes) => {
      const rows = [];
      let anyKept = false;
      for (const n of nodes) {
        const child = rec(n.children);
        if (predicate(n.row) || child.kept) {
          anyKept = true;
          rows.push({ row: n.row, depth: n.depth, hasChildren: child.kept, expanded: true, key: n.key });
          if (child.kept) rows.push(...child.rows);
        }
      }
      return { kept: anyKept, rows };
    };
    return rec(this.roots).rows;
  }

  isExpanded(key) { return this.expanded.has(key); }

  /* ---- přesun uzlů (drag & drop) ---- */

  /** Najde uzel + jeho rodičovské pole a rodičovský uzel. */
  findNode(key) {
    let res = { node: null, parentArr: null, parentNode: null };
    const walk = (nodes, pNode) => {
      for (const n of nodes) {
        if (n.key === key) { res = { node: n, parentArr: pNode ? pNode.children : this.roots, parentNode: pNode }; return true; }
        if (walk(n.children, n)) return true;
      }
      return false;
    };
    walk(this.roots, null);
    return res;
  }

  /** Je `node` uvnitř podstromu `anc` (včetně anc)? (ochrana proti přesunu do sebe) */
  contains(anc, node) {
    if (anc === node) return true;
    return anc.children.some((c) => this.contains(c, node));
  }

  /**
   * Přesune uzel (s celým podstromem) k cíli. zone: 'before' | 'after' (mezi
   * sourozence cíle) nebo 'inside' (jako potomek cíle). Vrací pole změněných
   * řádků (s aktualizovanými pořadovými poli) nebo null, když přesun není platný.
   */
  moveNode(dragKey, targetKey, zone) {
    if (dragKey === targetKey) return null;
    const d = this.findNode(dragKey);
    const t = this.findNode(targetKey);
    if (!d.node || !t.node) return null;
    if (this.contains(d.node, t.node)) return null; // nelze přesunout do vlastního potomka

    // odeber draga z původního rodiče
    d.parentArr.splice(d.parentArr.indexOf(d.node), 1);

    let destParent, destArr, index;
    if (zone === 'inside') {
      destParent = t.node; destArr = t.node.children; index = destArr.length;
    } else {
      const tp = this.findNode(targetKey); // znovu (indexy se po odebrání mohly posunout)
      destParent = tp.parentNode; destArr = tp.parentArr;
      index = destArr.indexOf(tp.node) + (zone === 'after' ? 1 : 0);
    }
    destArr.splice(index, 0, d.node);

    this.recomputeDepth();
    const changed = this.persistMove();
    return { row: d.node.row, toParentId: destParent ? destParent.row[this.idField] : null, toIndex: index, changed, format: this.format };
  }

  recomputeDepth() {
    const walk = (nodes, depth) => { for (const n of nodes) { n.depth = depth; walk(n.children, depth + 1); } };
    walk(this.roots, 0);
  }

  /** Zapíše přesun zpět do řádků dle formátu; vrací změněné řádky. */
  persistMove() {
    if (this.format === 'flat') return this.persistFlat();
    if (this.format === 'nested-set') return this.persistNestedSet();
    return this.persistNested();
  }

  /** parentId: přepíše parentField + (volitelně) přečísluje orderField sourozenců. */
  persistFlat() {
    const changed = new Set();
    const walk = (nodes, parentNode) => {
      nodes.forEach((n, i) => {
        const pid = parentNode ? parentNode.row[this.idField] : null;
        if (n.row[this.parentField] !== pid) { n.row[this.parentField] = pid; changed.add(n.row); }
        if (this.orderField && n.row[this.orderField] !== i + 1) { n.row[this.orderField] = i + 1; changed.add(n.row); }
        walk(n.children, n);
      });
    };
    walk(this.roots, null);
    return [...changed];
  }

  /** _children: přepíše childField pole u všech uzlů (řádky = jejich potomci). */
  persistNested() {
    const changed = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        const kids = n.children.map((c) => c.row);
        n.row[this.childField] = kids;
        changed.push(n.row);
        walk(n.children);
      }
    };
    walk(this.roots);
    return changed;
  }

  /** nested set: přečísluje lft/rgt celého stromu (preorder) a vrátí změněné. */
  persistNestedSet() {
    const changed = [];
    let c = 1;
    const walk = (n) => {
      const lft = c++;
      for (const kid of n.children) walk(kid);
      const rgt = c++;
      if (n.row[this.leftField] !== lft || n.row[this.rightField] !== rgt) {
        n.row[this.leftField] = lft; n.row[this.rightField] = rgt; changed.push(n.row);
      }
    };
    for (const r of this.roots) walk(r);
    return changed;
  }

  /**
   * Rozbalí / sbalí uzel (persistováno) a překreslí. Při SBALENÍ zapomene i celý
   * podstrom — po opětovném rozbalení jsou vnořené větve sbalené.
   */
  toggle(key) {
    if (this.expanded.has(key)) {
      const { node } = this.findNode(key);
      if (node) this.forgetSubtree(node); else this.expanded.delete(key);
    } else {
      this.expanded.add(key);
    }
    this.grid.saveState();
    this.grid.refresh();
  }

  /** Odebere z rozbalených uzel i celý jeho podstrom. */
  forgetSubtree(node) {
    this.expanded.delete(node.key);
    for (const c of node.children) this.forgetSubtree(c);
  }

  /** Nejhlubší úroveň uzlu s potomky (kolik úrovní lze rozbalit). */
  computeDepthMax() {
    let max = 0;
    const walk = (nodes) => { for (const n of nodes) { if (n.children.length) { max = Math.max(max, n.depth + 1); walk(n.children); } } };
    walk(this.roots);
    this.depthMax = max;
    return max;
  }

  /**
   * Rozbalí strom rovnoměrně do úrovně `n`: rozbalí všechny uzly s hloubkou < n
   * (takže je vidět úroveň n), hlubší sbalí. Nahrazuje celý stav rozbalení.
   */
  expandToLevel(n) {
    n = Math.max(0, Math.min(n, this.depthMax || 0));
    this.expanded.clear();
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.children.length && node.depth < n) this.expanded.add(node.key);
        walk(node.children);
      }
    };
    walk(this.roots);
    this.level = n;
    this.grid.saveState();
    this.grid.refresh();
  }

  /** Posune rovnoměrnou úroveň rozbalení o delta (±1). */
  stepLevel(delta) { this.expandToLevel((this.level || 0) + delta); }

  /** Rozbalí úplně vše. */
  expandAll() { this.expandToLevel(this.depthMax || 0); }

  /** Sbalí úplně vše (zůstanou jen kořeny). */
  collapseAll() { this.expandToLevel(0); }
}
