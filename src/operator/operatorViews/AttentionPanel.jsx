// operator/operatorViews/AttentionPanel.jsx
// Operator › Attention: the list of alarms and investigations, its
// group/sort controls and the card each item renders as. Selecting a card
// is what fills the centre with InvestigatePanel.

import { useState, useMemo } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { ATTENTION_ITEMS } from '../model/modelData';
import { AiPill } from '../badges';
import { ATTENTION_STATE_COLORS, ATTENTION_STATE_LABELS, ATTENTION_STATE_ORDER, SEVERITY_COLORS, SEVERITY_LABELS, SEVERITY_ORDER } from './statusVocabulary';

// ─────────────────────────────────────────────────────────────────────────────
// Attention controls — group-by / sort-by options and the logic behind them
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'severity', label: 'Severity' },
  { value: 'asset', label: 'Asset' },
  { value: 'state', label: 'State' },
];

const SORT_BY_OPTIONS = [
  { value: 'time', label: 'Time' },
  { value: 'severity', label: 'Severity' },
  { value: 'state', label: 'State' },
];

function sortAttentionItems(items, sortBy) {
  const sorted = [...items];
  if (sortBy === 'severity') {
    sorted.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  } else if (sortBy === 'state') {
    sorted.sort((a, b) => ATTENTION_STATE_ORDER[a.attentionState] - ATTENTION_STATE_ORDER[b.attentionState]);
  } else {
    // 'time' — most recent first (smallest elapsed time on top)
    sorted.sort((a, b) => a.sinceMinutes - b.sinceMinutes);
  }
  return sorted;
}

function groupAttentionItems(items, groupBy) {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, items }];
  }
  const buckets = {};
  items.forEach(item => {
    const key = groupBy === 'severity' ? item.severity : groupBy === 'state' ? item.attentionState : item.line;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });
  let keys = Object.keys(buckets);
  if (groupBy === 'severity') {
    keys.sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b]);
  } else if (groupBy === 'state') {
    keys.sort((a, b) => ATTENTION_STATE_ORDER[a] - ATTENTION_STATE_ORDER[b]);
  } else {
    keys.sort((a, b) => a.localeCompare(b));
  }
  return keys.map(key => ({
    key,
    label: groupBy === 'severity' ? SEVERITY_LABELS[key] : groupBy === 'state' ? ATTENTION_STATE_LABELS[key] : key,
    items: buckets[key],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Attention — ranked list
// ─────────────────────────────────────────────────────────────────────────────

function AttentionCard({ item, selected, pinned, onSelect, onTogglePin }) {
  return (
    <div
      className={`op-attention-card${selected ? ' op-attention-card--selected' : ''}`}
      onClick={() => onSelect(item.id)}
    >
      <div className="op-attention-card-top">
        <span className="op-severity-dot" style={{ background: SEVERITY_COLORS[item.severity] }} />
        <span className="op-attention-asset">{item.asset}</span>
        <span
          className="op-attention-state-badge"
          style={{ color: ATTENTION_STATE_COLORS[item.attentionState] }}
          title={ATTENTION_STATE_LABELS[item.attentionState]}
        >
          {ATTENTION_STATE_LABELS[item.attentionState]}
        </span>
        <span className="op-attention-since">{item.since}</span>
        <button
          className={`op-pin-btn${pinned ? ' op-pin-btn--active' : ''}`}
          onClick={e => { e.stopPropagation(); onTogglePin(item.id); }}
          title={pinned ? 'Unpin' : 'Pin to top'}
        >
          📌
        </button>
      </div>
      <div className="op-attention-signal">{item.signal}</div>
      <div className="op-attention-interpretation">
        <AiPill />
        <span className="op-attention-interpretation-text">{item.aiInterpretation}</span>
      </div>
      <div className="op-attention-recommendation">
        <AiPill />
        <span className="op-attention-recommendation-text">{item.detail.recommendation}</span>
      </div>
    </div>
  );
}

export function AttentionPanel({ selectedId, onSelect }) {
  const [groupBy, setGroupBy] = useState('severity');
  const [sortBy, setSortBy] = useState('time');
  const [pinnedIds, setPinnedIds] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(['medium', 'low']);

  const togglePin = (id) => {
    setPinnedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleGroupCollapsed = (key) => {
    setCollapsedGroups(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const pinnedItems = useMemo(
    () => sortAttentionItems(ATTENTION_ITEMS.filter(i => pinnedIds.includes(i.id)), sortBy),
    [pinnedIds, sortBy]
  );

  const groupingActive = groupBy !== 'none';
  const pinnedCollapsed = groupingActive && collapsedGroups.includes('pinned');

  const groups = useMemo(() => {
    const unpinned = ATTENTION_ITEMS.filter(i => !pinnedIds.includes(i.id));
    const sorted = sortAttentionItems(unpinned, sortBy);
    return groupAttentionItems(sorted, groupBy);
  }, [groupBy, sortBy, pinnedIds]);

  return (
    <div className="op-panel op-attention-panel">
      <div className="op-zone-label">Attention</div>

      <div className="op-attention-controls">
        <div className="op-control">
          <span className="op-control-label">Group by</span>
          <SelectBox
            dataSource={GROUP_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={groupBy}
            onValueChanged={e => setGroupBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
        <div className="op-control">
          <span className="op-control-label">Sort by</span>
          <SelectBox
            dataSource={SORT_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={sortBy}
            onValueChanged={e => setSortBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
      </div>

      <div className="op-attention-list">
        {pinnedItems.length > 0 && (
          <div>
            <div
              className={`op-attention-group-header op-attention-group-header--pinned${groupingActive ? ' op-attention-group-header--clickable' : ''}`}
              onClick={groupingActive ? () => toggleGroupCollapsed('pinned') : undefined}
            >
              {groupingActive && (
                <span className={`op-group-chevron${pinnedCollapsed ? ' op-group-chevron--collapsed' : ''}`}>▾</span>
              )}
              <span className="op-pin-icon">📌</span>
              Pinned
              <span className="op-group-count-badge">{pinnedItems.length}</span>
            </div>
            {!pinnedCollapsed && pinnedItems.map(item => (
              <AttentionCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                pinned={true}
                onSelect={onSelect}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}

        {groups.map(group => {
          const collapsed = group.label && collapsedGroups.includes(group.key);
          return (
            <div key={group.key}>
              {group.label && (
                <div
                  className="op-attention-group-header op-attention-group-header--clickable"
                  onClick={() => toggleGroupCollapsed(group.key)}
                >
                  <span className={`op-group-chevron${collapsed ? ' op-group-chevron--collapsed' : ''}`}>▾</span>
                  {group.label}
                  <span className="op-group-count-badge">{group.items.length}</span>
                </div>
              )}
              {!collapsed && group.items.map(item => (
                <AttentionCard
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  pinned={false}
                  onSelect={onSelect}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
