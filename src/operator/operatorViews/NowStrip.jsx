// operator/operatorViews/NowStrip.jsx
// The strip across the top of the Operator side: each line's current
// state and how long it's held it, as a row of selectable tiles.

import { useMemo } from 'react';
import { NowStatusIcon } from '../icons';
import { nowTileIdToAssetId } from '../model/assetQueries';
import { LINE_STATUS, OPERATING_CONTEXT_BY_LINE } from '../model/modelData';
import { OPERATING_MODE_COLORS, STATE_COLORS, STATE_LABELS } from './statusVocabulary';

function formatStatusDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Attention first (needs a person to look), changeover second (expected,
// but worth a glance since it's a transition), running last (calm).
// 'down' only occurs in generic packs so far (unit-status.json); without an
// entry here it sorted as NaN, leaving down units in an arbitrary position.
const LINE_STATE_PRIORITY = { attention: 0, down: 1, changeover: 2, running: 3 };

export function NowStrip({ selectedLine, onSelectLine }) {
  const orderedLines = useMemo(
    () => [...LINE_STATUS].sort((a, b) => LINE_STATE_PRIORITY[a.state] - LINE_STATE_PRIORITY[b.state]),
    []
  );
  return (
    <div className="op-now-strip">
      <div className="op-zone-label">Now</div>
      <div className="op-now-tiles">
        {orderedLines.map(line => {
          const ctx = OPERATING_CONTEXT_BY_LINE[line.id];
          return (
            <button
              key={line.id}
              className={`op-now-tile${selectedLine === nowTileIdToAssetId(line.id) ? ' op-now-tile--selected' : ''}`}
              onClick={() => onSelectLine(nowTileIdToAssetId(line.id))}
            >
              <div className="op-now-tile-top">
                <span className="op-now-dot" style={{ background: STATE_COLORS[line.state] }} />
                <span className="op-now-tile-label">{line.label}</span>
              </div>
              <div className="op-now-tile-status-row">
                <span className="op-now-tile-status-icon" style={{ color: STATE_COLORS[line.state] }}>
                  <NowStatusIcon state={line.state} />
                </span>
                <span className="op-now-tile-status-text" style={{ color: STATE_COLORS[line.state] }}>
                  {STATE_LABELS[line.state]}
                </span>
              </div>
              {line.statusSinceMinutes != null && (
                <div className="op-now-tile-duration">for {formatStatusDuration(line.statusSinceMinutes)}</div>
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
