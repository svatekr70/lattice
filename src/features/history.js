/**
 * History — undo/redo změn dat (client-side). Sleduje: úpravu buňky (edit),
 * přidání/smazání řádku (add/delete) a dávkové změny (batch — hromadné úpravy,
 * vložení rozsahu ze schránky). Přesouvání řádků se nesleduje.
 *
 * Velikost historie je omezená (options.historySize, default 50) — starší kroky
 * vypadnou. `clear()` historii smaže.
 */
export class History {
  constructor(grid, size) {
    this.grid = grid;
    this.max = Math.max(1, size || 50);
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Zaznamená krok (ignoruje se během přehrávání undo/redo). */
  record(entry) {
    if (this.grid._replayingHistory || !entry) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack.length = 0;
    this.grid.renderer.renderToolbar();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undoSize() { return this.undoStack.length; }
  redoSize() { return this.redoStack.length; }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.grid.renderer.renderToolbar();
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this._apply(e, 'undo');
    this.redoStack.push(e);
    this.grid.renderer.renderToolbar();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this._apply(e, 'redo');
    this.undoStack.push(e);
    this.grid.renderer.renderToolbar();
  }

  _apply(e, dir) {
    const grid = this.grid;
    grid._replayingHistory = true;
    try {
      if (e.type === 'batch') {
        const list = dir === 'undo' ? [...e.entries].reverse() : e.entries;
        for (const sub of list) this._atom(sub, dir);
      } else {
        this._atom(e, dir);
      }
      grid.refresh();
    } finally {
      grid._replayingHistory = false;
    }
  }

  /** Provede jednu atomickou změnu (bez refreshe). */
  _atom(e, dir) {
    const grid = this.grid;
    const src = grid.dataSource;
    if (e.type === 'edit') {
      Object.assign(e.row, dir === 'undo' ? e.before : e.after);
    } else if (e.type === 'add') {
      if (dir === 'undo') src.deleteRow(grid.keyField, grid.rowKey(e.row));
      else src.addRow(e.row, e.atStart);
    } else if (e.type === 'delete') {
      // undo obnoví řádek na jeho původní pozici (ne na konec); batch se přehrává
      // v opačném pořadí, takže indexy zachycené při mazání sedí.
      if (dir === 'undo') { if (src.insertRow) src.insertRow(e.row, e.index); else src.addRow(e.row); }
      else src.deleteRow(grid.keyField, grid.rowKey(e.row));
    }
  }
}
