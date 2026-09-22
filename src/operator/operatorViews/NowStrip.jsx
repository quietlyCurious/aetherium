// operator/operatorViews/NowStrip.jsx
// The strip across the top of the Operator side: each unit of operation's
// current state and how long it's held it, as a row of selectable tiles
// (one per unit-level asset, from unit-status.json).

import { useMemo } from 'react';
import { NowStatusIcon } from '../icons';
import { UNIT_OPERATING_CONTEXT, UNIT_STATUS_TILES } from '../../model/modelData';
import { OPERATING_MODE_COLORS, STATE_COLORS, STATE_LABELS } from './statusVocabulary';

function formatStatusDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Attention first (needs a person to look), changeover second (expected,
// but worth a glance since it's a transition), running last (calm).
// Down sits between them: it matters, but it's usually already known.
const UNIT_STATE_PRIORITY = { attention: 0, down: 1, changeover: 2, running: 3 };

export function NowStrip({ selectedUnitId, onSelectUnit }) {
  const orderedUnits = useMemo(
    () => [...UNIT_STATUS_TILES].sort((a, b) => UNIT_STATE_PRIORITY[a.state] - UNIT_STATE_PRIORITY[b.state]),
    []
  );
  return (
    <div className="op-now-strip">
      <div className="op-zone-label">Now</div>
      <div className="op-now-tiles">
        {orderedUnits.map(unit => {
          const ctx = UNIT_OPERATING_CONTEXT[unit.id];
          return (
            <button
              key={unit.id}
              className={`op-now-tile${selectedUnitId === unit.id ? ' op-now-tile--selected' : ''}`}
              onClick={() => onSelectUnit(unit.id)}
            >
              <div className="op-now-tile-top">
                <span className="op-now-dot" style={{ background: STATE_COLORS[unit.state] }} />
                <span className="op-now-tile-label">{unit.label}</span>
              </div>
              <div className="op-now-tile-status-row">
                <span className="op-now-tile-status-icon" style={{ color: STATE_COLORS[unit.state] }}>
                  <NowStatusIcon state={unit.state} />
                </span>
                <span className="op-now-tile-status-text" style={{ color: STATE_COLORS[unit.state] }}>
                  {STATE_LABELS[unit.state]}
                </span>
              </div>
              {unit.statusSinceMinutes != null && (
                <div className="op-now-tile-duration">for {formatStatusDuration(unit.statusSinceMinutes)}</div>
              )}
              {ctx && (
                <div className="op-now-tile-context">
                  <span className="op-now-tile-mode" style={{ color: OPERATING_MODE_COLORS[ctx.mode] }}>
                    {ctx.mode.replace('_', ' ')}
                  </span>
                  <span className="op-now-tile-product">{ctx.product}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
