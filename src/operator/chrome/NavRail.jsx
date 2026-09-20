// operator/chrome/NavRail.jsx
// The left icon rail. Its items are the persona's work areas —
// Visualization for the Configurator; Attention, Work and Assets for the
// Operator — and the chosen one sets railMode, which decides what the
// left list and centre show.

import { useState } from 'react';
import { VisualizationRailIcon, AttentionRailIcon, WorkTabIcon, AssetsRailIcon } from '../icons';

export function NavRail({ mode, hidden, onIconClick, attentionCount, workCount, operatorPersona }) {
  const [expanded, setExpanded] = useState(false);

  const allItems = [
    { id: 'now', label: 'Visualization', Icon: VisualizationRailIcon, count: 0 },
    { id: 'attention', label: 'Attention', Icon: AttentionRailIcon, count: attentionCount },
    { id: 'work', label: 'Work', Icon: WorkTabIcon, count: workCount },
    { id: 'assets', label: 'Assets', Icon: AssetsRailIcon, count: 0 },
  ];
  const items = operatorPersona === 'configurator'
    ? allItems.filter(item => item.id === 'now')
    : allItems.filter(item => item.id !== 'now');

  return (
    <div className={`op-nav-rail${expanded ? ' op-nav-rail--expanded' : ''}`}>
      <button
        className="op-nav-rail-toggle"
        onClick={() => setExpanded(e => !e)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? '‹' : '›'}
      </button>

      {items.map(item => {
        const isActive = mode === item.id && !hidden;
        return (
          <button
            key={item.id}
            className={`op-nav-rail-item${isActive ? ' op-nav-rail-item--active' : ''}`}
            onClick={() => onIconClick(item.id)}
            title={mode === item.id ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`) : item.label}
          >
            <span className="op-nav-rail-icon">
              <item.Icon />
              {!expanded && item.count > 0 && <span className="op-nav-rail-dot" />}
            </span>
            {expanded && <span className="op-nav-rail-label">{item.label}</span>}
            {expanded && item.count > 0 && <span className="op-nav-rail-count">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
