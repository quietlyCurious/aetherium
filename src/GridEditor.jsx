import React from 'react';

function migrateGridCells(oldCells, oldCols, oldRows, newCols, newRows) {
  const newCells = buildDefaultCells(newCols, newRows);

  // For each old cell, find the best matching new cell and transfer childIds
  oldCells.forEach(oldCell => {
    const childIds = oldCell.childIds || (oldCell.childId != null ? [oldCell.childId] : []);
    if (childIds.length === 0) return;

    // Clamp the old cell's position to the new grid bounds
    const clampedColStart = Math.min(oldCell.colStart, newCols);
    const clampedRowStart = Math.min(oldCell.rowStart, newRows);

    // Find the new cell that contains this position
    const targetCell = newCells.find(c =>
      c.colStart <= clampedColStart && c.colEnd > clampedColStart &&
      c.rowStart <= clampedRowStart && c.rowEnd > clampedRowStart
    );

    if (targetCell) {
      targetCell.childIds = [...(targetCell.childIds || []), ...childIds];
    } else {
      // Fallback: add to last cell if position is completely out of bounds
      if (newCells.length > 0) {
        newCells[newCells.length - 1].childIds = [
          ...(newCells[newCells.length - 1].childIds || []),
          ...childIds
        ];
      }
    }
  });

  return newCells;
}

function buildDefaultCells(cols, rows) {
  const cells = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      cells.push({ id: `${r}-${c}`, colStart: c, colEnd: c + 1, rowStart: r, rowEnd: r + 1, childIds: [] });
    }
  }
  return cells;
}

function GridEditor({ layout, onUpdateLayout, onMergeCellContainers }) {
  const cols = layout.gridColumns || 2;
  const rows = layout.gridRows || 2;
  const cells = layout.gridCells || buildDefaultCells(cols, rows);
  const mergeDir = layout.gridMergeDirection || 'horizontal';

  const mergeAtPoint = (axis, colLine, rowLine) => {
    const updated = cells.map(c => ({ ...c }));
    if (axis === 'col') {
      const lc = updated.find(c => c.colEnd === colLine && c.rowStart === rowLine);
      const rc = lc ? updated.find(c => c.colStart === colLine && c.rowStart === lc.rowStart && c.rowEnd === lc.rowEnd) : null;
      if (lc && rc) {
        const absorbedIds = rc.childIds || [];
        lc.colEnd = rc.colEnd;
        lc.childIds = [...(lc.childIds||[]), ...absorbedIds];
        updated.splice(updated.indexOf(rc), 1);
        onUpdateLayout({ gridCells: updated });
        if (onMergeCellContainers && absorbedIds.length > 0) {
          const survivingIds = lc.childIds.filter(id => !absorbedIds.includes(id));
          if (survivingIds.length > 0) onMergeCellContainers(survivingIds[0], absorbedIds);
        }
      }
    } else {
      const tc = updated.find(c => c.rowEnd === rowLine && c.colStart === colLine);
      const bc = tc ? updated.find(c => c.rowStart === rowLine && c.colStart === tc.colStart && c.colEnd === tc.colEnd) : null;
      if (tc && bc) {
        const absorbedIds = bc.childIds || [];
        tc.rowEnd = bc.rowEnd;
        tc.childIds = [...(tc.childIds||[]), ...absorbedIds];
        updated.splice(updated.indexOf(bc), 1);
        onUpdateLayout({ gridCells: updated });
        if (onMergeCellContainers && absorbedIds.length > 0) {
          const survivingIds = tc.childIds.filter(id => !absorbedIds.includes(id));
          if (survivingIds.length > 0) onMergeCellContainers(survivingIds[0], absorbedIds);
        }
      }
    }
  };

  const resetCells = () => onUpdateLayout({ gridCells: null });

  const colBoundaryExists = (colLine, rowStart) => cells.some(c => c.colEnd === colLine && c.rowStart === rowStart);
  const rowBoundaryExists = (rowLine, colStart) => cells.some(c => c.rowEnd === rowLine && c.colStart === colStart);
  const SOLID = '1px solid rgba(180,180,180,0.5)';
  const DASH_COLOR = 'rgba(160,160,160,0.6)';
  const DASH_HOVER = '#0078d4';

  // Renders one divider segment — solid if not mergeable in current direction, dashed if it is
  const VSegment = ({ ci, ri }) => {
    const colLine = ci + 2;
    const rowStart = ri + 1;
    const exists = colBoundaryExists(colLine, rowStart);
    if (!exists) return null;
    const canMerge = mergeDir === 'horizontal';
    const colPct = ((ci + 1) / cols) * 100;
    const rowPct = (ri / rows) * 100;
    const heightPct = (1 / rows) * 100;
    if (!canMerge) {
      return (
        <div key={`vd-${ci}-${ri}`} style={{ position: 'absolute', top: `${rowPct}%`, height: `${heightPct}%`, left: `calc(${colPct}% - 0.5px)`, width: 1, background: 'rgba(180,180,180,0.5)', pointerEvents: 'none', zIndex: 1 }} />
      );
    }
    return (
      <div key={`vd-${ci}-${ri}`} title="Click to merge"
        style={{ position: 'absolute', top: `${rowPct}%`, height: `${heightPct}%`, left: `calc(${colPct}% - 4px)`, width: 8, cursor: 'col-resize', zIndex: 2, pointerEvents: 'all', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={(e) => { e.stopPropagation(); mergeAtPoint('col', colLine, rowStart); }}
      >
        <div className="grid-divider-v"
          style={{ width: 1, height: '100%', backgroundImage: `repeating-linear-gradient(to bottom, ${DASH_COLOR} 0px, ${DASH_COLOR} 4px, transparent 4px, transparent 8px)`, transition: 'background-image 0.12s' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundImage = `repeating-linear-gradient(to bottom, ${DASH_HOVER} 0px, ${DASH_HOVER} 4px, transparent 4px, transparent 8px)`; e.currentTarget.style.width = '2px'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundImage = `repeating-linear-gradient(to bottom, ${DASH_COLOR} 0px, ${DASH_COLOR} 4px, transparent 4px, transparent 8px)`; e.currentTarget.style.width = '1px'; }}
        />
      </div>
    );
  };

  const HSegment = ({ ci, ri }) => {
    const rowLine = ri + 2;
    const colStart = ci + 1;
    const exists = rowBoundaryExists(rowLine, colStart);
    if (!exists) return null;
    const canMerge = mergeDir === 'vertical';
    const rowPct = ((ri + 1) / rows) * 100;
    const colPct = (ci / cols) * 100;
    const widthPct = (1 / cols) * 100;
    if (!canMerge) {
      return (
        <div key={`hd-${ri}-${ci}`} style={{ position: 'absolute', left: `${colPct}%`, width: `${widthPct}%`, top: `calc(${rowPct}% - 0.5px)`, height: 1, background: 'rgba(180,180,180,0.5)', pointerEvents: 'none', zIndex: 1 }} />
      );
    }
    return (
      <div key={`hd-${ri}-${ci}`} title="Click to merge"
        style={{ position: 'absolute', left: `${colPct}%`, width: `${widthPct}%`, top: `calc(${rowPct}% - 4px)`, height: 8, cursor: 'row-resize', zIndex: 2, pointerEvents: 'all', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={(e) => { e.stopPropagation(); mergeAtPoint('row', colStart, rowLine); }}
      >
        <div className="grid-divider-h"
          style={{ height: 1, width: '100%', backgroundImage: `repeating-linear-gradient(to right, ${DASH_COLOR} 0px, ${DASH_COLOR} 4px, transparent 4px, transparent 8px)`, transition: 'background-image 0.12s' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundImage = `repeating-linear-gradient(to right, ${DASH_HOVER} 0px, ${DASH_HOVER} 4px, transparent 4px, transparent 8px)`; e.currentTarget.style.height = '2px'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundImage = `repeating-linear-gradient(to right, ${DASH_COLOR} 0px, ${DASH_COLOR} 4px, transparent 4px, transparent 8px)`; e.currentTarget.style.height = '1px'; }}
        />
      </div>
    );
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      {/* All vertical dividers */}
      {Array.from({ length: cols - 1 }, (_, ci) =>
        Array.from({ length: rows }, (_, ri) => <VSegment key={`v-${ci}-${ri}`} ci={ci} ri={ri} />)
      )}
      {/* All horizontal dividers */}
      {Array.from({ length: rows - 1 }, (_, ri) =>
        Array.from({ length: cols }, (_, ci) => <HSegment key={`h-${ri}-${ci}`} ci={ci} ri={ri} />)
      )}
      {layout.gridCells && (
        <div title="Reset all merges" onClick={(e) => { e.stopPropagation(); resetCells(); }}
          style={{ position: 'absolute', top: 4, right: 4, fontSize: 10, color: '#0078d4', cursor: 'pointer', background: 'rgba(255,255,255,0.85)', padding: '1px 5px', borderRadius: 3, border: '1px solid #0078d4', zIndex: 3, pointerEvents: 'all' }}>
          reset
        </div>
      )}
    </div>
  );
}

export { buildDefaultCells, migrateGridCells };
export default GridEditor;
