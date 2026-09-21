// shell/AreaRail.jsx
// The left icon rail: a workspace's areas, in groups. The Configuration
// Experience's rail (Visualization, the page-builder areas, the data
// areas) is drawn by App, outside any one area, so it stays put while you
// move between them. The Operator Experience's rail (Attention, Work,
// Assets) is drawn inside OperatorWorkspace, which owns its counts.
//
// groups:   [{ id, label?, items: [{ id, label, Icon, count?, collapsesList? }] }]
//           Collapsed, groups are separated by a divider; expanded (›),
//           each group's label sits above it.
// activeId: the area showing.
// hidden:   the active area's list panel is hidden. An item with
//           collapsesList hides and shows its area's list panel when
//           clicked again — its tooltip says so.
// onSelect(id): an item was clicked (including the active one).

import { useState } from 'react';

export function AreaRail({ groups, activeId, hidden = false, onSelect }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`app-rail${expanded ? ' app-rail--expanded' : ''}`}>
      <button
        className="app-rail-toggle"
        onClick={() => setExpanded(e => !e)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? '‹' : '›'}
      </button>

      {groups.map((group, groupIndex) => [
        groupIndex > 0 && !expanded && <div key={`${group.id}-divider`} className="app-rail-divider" />,
        expanded && group.label && <div key={`${group.id}-label`} className="app-rail-group">{group.label}</div>,
        ...group.items.map(item => {
          const isActive = activeId === item.id && !hidden;
          const title = activeId === item.id && item.collapsesList
            ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`)
            : item.label;
          return (
            <button
              key={item.id}
              className={`app-rail-item${isActive ? ' app-rail-item--active' : ''}`}
              onClick={() => onSelect(item.id)}
              title={title}
            >
              <span className="app-rail-icon">
                <item.Icon />
                {!expanded && item.count > 0 && <span className="app-rail-dot" />}
              </span>
              {expanded && <span className="app-rail-label">{item.label}</span>}
              {expanded && item.count > 0 && <span className="app-rail-count">{item.count}</span>}
            </button>
          );
        }),
      ])}
    </div>
  );
}
