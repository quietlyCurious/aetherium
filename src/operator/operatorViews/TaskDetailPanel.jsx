// operator/operatorViews/TaskDetailPanel.jsx
// The centre panel for a selected work item: what it is, where it came
// from, its schedule margin and its completion toggle.

import { WORK_PRIORITY_COLORS, WORK_PRIORITY_LABELS, WORK_SOURCE_TYPE_LABELS, computeMarginMinutes, formatCreatedAt, formatMargin, marginColor } from './workItems';

// ─────────────────────────────────────────────────────────────────────────────
// Task detail — same panel slot as Investigate, shown when the nav rail is
// in Work mode. Deliberately minimal for now: name, description, created
// datetime, done status — can grow into something richer later.
// ─────────────────────────────────────────────────────────────────────────────

export function TaskDetailPanel({ item, onToggleDone }) {
  if (!item) {
    return (
      <div className="op-panel op-investigate-panel">
        <div className="op-zone-label">Investigate</div>
        <div className="op-investigate-empty">Select a task to see its details.</div>
      </div>
    );
  }

  const margin = computeMarginMinutes(item);
  const marginText = !item.done ? formatMargin(margin) : null;
  const createdText = formatCreatedAt(item.createdAt);

  return (
    <div className="op-panel op-investigate-panel">
      <div className="op-zone-label">Investigate</div>

      <div className="op-investigate-header">
        <span className="op-work-priority-dot" style={{ background: WORK_PRIORITY_COLORS[item.priority] }} />
        <div>
          <div className="op-investigate-asset">{item.assetLabel || (item.source === 'ai' ? 'AI-created task' : 'Task')}</div>
          <div className="op-investigate-signal">{item.text}</div>
        </div>
        <button className="op-btn op-btn--primary op-investigate-header-action" onClick={() => onToggleDone(item.id)}>
          {item.done ? 'Mark as not done' : 'Mark as done'}
        </button>
      </div>

      <div className="op-investigate-chain">
        <div className="op-chain-row">
          <div className="op-chain-label">Description</div>
          <div className="op-chain-value">{item.description || 'No additional description.'}</div>
        </div>
        <div className="op-chain-row">
          <div className="op-chain-label">Type</div>
          <div className="op-chain-value">
            {item.workType || 'General'} · {WORK_PRIORITY_LABELS[item.priority]}
          </div>
        </div>
        <div className="op-chain-row">
          <div className="op-chain-label">Source</div>
          <div className="op-chain-value">
            {WORK_SOURCE_TYPE_LABELS[item.sourceType] || 'Planned'}
            {item.sourceLabel ? ` — ${item.sourceLabel}` : ''}
          </div>
        </div>
        {item.assignedRole && (
          <div className="op-chain-row">
            <div className="op-chain-label">Assigned to</div>
            <div className="op-chain-value">{item.assignedRole}</div>
          </div>
        )}
        {item.dueAt && (
          <div className="op-chain-row">
            <div className="op-chain-label">Due</div>
            <div className="op-chain-value">
              {formatCreatedAt(item.dueAt)}
              {marginText && <span style={{ color: marginColor(margin), fontWeight: 700 }}> · {marginText}</span>}
            </div>
          </div>
        )}
        {createdText && (
          <div className="op-chain-row">
            <div className="op-chain-label">Created</div>
            <div className="op-chain-value">{createdText}</div>
          </div>
        )}
        <div className="op-chain-row">
          <div className="op-chain-label">Status</div>
          <div className="op-chain-value">{item.done ? 'Done' : 'Not done'}</div>
        </div>
      </div>

      {item.dependencies && (
        <div className="op-investigate-chain op-work-dependencies">
          <div className="op-chain-label" style={{ marginBottom: 4 }}>Dependencies</div>
          {item.dependencies.map((dep, i) => (
            <div key={i} className={`op-dependency-row${dep.done ? ' op-dependency-row--done' : ''}`}>
              <span className="op-dependency-check">{dep.done ? '✓' : '○'}</span>
              <span>{dep.label}</span>
            </div>
          ))}
          {item.progressNote && <div className="op-dash-text op-dash-text--muted" style={{ marginTop: 6 }}>{item.progressNote}</div>}
        </div>
      )}
    </div>
  );
}
