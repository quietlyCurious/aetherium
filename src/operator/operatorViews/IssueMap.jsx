// operator/operatorViews/IssueMap.jsx
// The lines × stations grid of current issues, and the overlay that
// expands it over the workspace. Cells carry the worst severity present at
// that station; clicking one selects the issue, clicking a line opens
// LineDetail.

import { useMemo } from 'react';
import { ATTENTION_ITEMS } from '../model/modelData';
import { LineDetail } from './LineDetail';
import { SEVERITY_COLORS } from './statusVocabulary';

// ─────────────────────────────────────────────────────────────────────────────
// Issue map — a plant-wide heatmap of which line/station combinations have a
// real logged issue (from ATTENTION_ITEMS, which is itself sourced from the
// real event log) vs which are clean. First pass at visualizing where issues
// are actually concentrated, per request — this is what makes "Aurelia has
// zero events, Ferrum has several" visible at a glance instead of something
// you have to notice by reading the Attention list closely.
// ─────────────────────────────────────────────────────────────────────────────

const AURELIA_LINES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

const AURELIA_STATIONS = ['Intake', 'Stabilization', 'Refinement', 'Inspection', 'Buffer', 'Output'];

const FERRUM_LINES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

const FERRUM_STATIONS = ['Bulk Intake', 'Power Charge', 'Shaping', 'Transfer', 'Output'];

const STATION_ABBR = {
  'Intake': 'Intake', 'Stabilization': 'Stabil.', 'Refinement': 'Refine.',
  'Inspection': 'Inspect.', 'Buffer': 'Buffer', 'Output': 'Output',
  'Bulk Intake': 'Bulk In', 'Power Charge': 'Pwr Chg', 'Shaping': 'Shaping', 'Transfer': 'Transfer',
};

const ISSUEMAP_CLEAN_COLOR = '#3fa66c';

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function buildIssueLookup() {
  const map = {};
  ATTENTION_ITEMS.forEach(item => {
    // asset is "Refinery · Line · Station" for station-level items, or just
    // "Refinery · Line" for line-wide informational items (e.g. att-9) —
    // only the former maps onto a specific heatmap cell.
    const parts = item.asset.split(' · ');
    if (parts.length < 3) return;
    const line = parts[1];
    const station = parts[2];
    const key = `${line}|${station}`;
    const existing = map[key];
    // "Resolved" here means the situation has actually concluded
    // (detail.outcomeStatus), not how urgent it was — attentionState answers
    // a different question (how urgent is this) than whether it's still
    // open at all, and a low-urgency-but-still-open item should still read
    // as active, not muted.
    const isResolved = item.detail.outcomeStatus === 'resolved';
    if (!existing || SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]) {
      map[key] = { severity: item.severity, id: item.id, signal: item.signal, resolved: isResolved };
    } else if (!isResolved && existing.resolved) {
      // A still-open item shares this cell with a higher-severity resolved
      // one — keep the cell reading as active rather than letting the
      // resolved item's color choice silently mute it.
      existing.resolved = false;
    }
  });
  return map;
}

function IssueMapGrid({ title, lines, stations, lookup, onSelectIssue }) {
  return (
    <div className="op-issuemap-group">
      <div className="op-issuemap-group-title">{title}</div>
      <table className="op-issuemap-table">
        <thead>
          <tr>
            <th></th>
            {stations.map(st => (
              <th key={st} title={st}>{STATION_ABBR[st] || st}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line}>
              <th>{line}</th>
              {stations.map(st => {
                const hit = lookup[`${line}|${st}`];
                const color = hit ? SEVERITY_COLORS[hit.severity] : ISSUEMAP_CLEAN_COLOR;
                const isResolved = hit && hit.resolved;
                return (
                  <td key={st}>
                    <div
                      className={`op-issuemap-cell${hit ? ' op-issuemap-cell--issue' : ''}${isResolved ? ' op-issuemap-cell--resolved' : ''}`}
                      style={isResolved ? { borderColor: color } : { background: color }}
                      title={hit ? `${line} · ${st}: ${hit.signal}${isResolved ? ' (resolved)' : ''}` : `${line} · ${st}: no issues logged`}
                      onClick={hit ? () => onSelectIssue(hit.id) : undefined}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The tab is the bottom 20px of this SAME element, not a separately
// positioned control — collapsed, the element sits translated up almost
// its full height so only that bottom strip (the tab) pokes out below the
// Now strip; clicking slides the whole rigid box down to translateY(0),
// so the tab visibly travels down together with the content, ending up at
// the true bottom of the fully revealed panel. Same idea reversed to close.
export function IssueMapOverlay({ expanded, onToggle, onSelectIssue, selectedDetailLine, onCloseDetailLine, topOffset }) {
  return (
    <div
      className={`op-now-issuemap-overlay${expanded ? ' op-now-issuemap-overlay--open' : ''}`}
      style={{ top: topOffset, bottom: 100 }}
    >
      <div className="op-issuemap-content">
        <IssueMap onSelectIssue={onSelectIssue} selectedDetailLine={selectedDetailLine} onCloseDetailLine={onCloseDetailLine} />
      </div>
      <button
        className="op-now-pulltab"
        onClick={onToggle}
        title={expanded ? 'Hide issue map' : 'Show issue map'}
      >
        <span className={`op-now-pulltab-chevron${expanded ? ' op-now-pulltab-chevron--open' : ''}`}>▾</span>
      </button>
    </div>
  );
}

function IssueMap({ onSelectIssue, selectedDetailLine, onCloseDetailLine }) {
  const lookup = useMemo(buildIssueLookup, []);
  const lineLabel = selectedDetailLine
    ? (selectedDetailLine.startsWith('AUR') ? 'Aurelia · A' : 'Ferrum · F') + selectedDetailLine.slice(-1)
    : null;

  return (
    <div className="op-issuemap-content">
      {selectedDetailLine ? (
        <LineDetail line={selectedDetailLine} label={lineLabel} onClose={onCloseDetailLine} />
      ) : (
        <>
          <div className="op-issuemap-section-label">Issue Map</div>
          <div className="op-issuemap-legend">
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: ISSUEMAP_CLEAN_COLOR }} />Clean</span>
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.low }} />Low</span>
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.medium }} />Medium</span>
            <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.high }} />High</span>
          </div>
          <div className="op-issuemap-body">
            <IssueMapGrid title="Aurelia" lines={AURELIA_LINES} stations={AURELIA_STATIONS} lookup={lookup} onSelectIssue={onSelectIssue} />
            <IssueMapGrid title="Ferrum" lines={FERRUM_LINES} stations={FERRUM_STATIONS} lookup={lookup} onSelectIssue={onSelectIssue} />
          </div>
        </>
      )}
    </div>
  );
}
