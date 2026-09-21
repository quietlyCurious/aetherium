// operator/chrome/RightRail.jsx
// The right icon rail: which panel the right-hand side shows (Details,
// Chat, AI), and the unread marker on Chat.

import { ChatTabIcon, AiTabIcon, DetailsTabIcon } from '../icons';

// ─────────────────────────────────────────────────────────────────────────────
// Right rail — mirrors the left rail's look (shell/AreaRail), but always icon-only (no expand/
// collapse — per request, this one never needs a label view) and switches
// the right panel between Chat and AI. Room to add more icons later for
// other right-panel content, same pattern as the left rail's items array.
// ─────────────────────────────────────────────────────────────────────────────

const RIGHT_RAIL_ITEMS = [
  { id: 'chat', label: 'Chat', Icon: ChatTabIcon },
  { id: 'ai', label: 'AI chat', Icon: AiTabIcon },
];

// Details (the selected type's Properties/Related Assets/All Assets tabs)
// is a Configurator-only concern — Operator has no reason to edit a
// type's templates, so this stays out of their right rail entirely
// rather than appearing as a mode they'd never use.
const RIGHT_RAIL_ITEMS_CONFIGURATOR = [
  ...RIGHT_RAIL_ITEMS,
  { id: 'details', label: 'Details', Icon: DetailsTabIcon },
];

export function RightRail({ mode, hidden, onIconClick, hasUnread, operatorPersona }) {
  const items = operatorPersona === 'configurator' ? RIGHT_RAIL_ITEMS_CONFIGURATOR : RIGHT_RAIL_ITEMS;
  return (
    <div className="app-rail app-rail--right">
      {items.map(item => {
        const isActive = mode === item.id && !hidden;
        return (
          <button
            key={item.id}
            className={`app-rail-item${isActive ? ' app-rail-item--active' : ''}`}
            onClick={() => onIconClick(item.id)}
            title={mode === item.id ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`) : item.label}
          >
            <span className="app-rail-icon">
              <item.Icon />
              {item.id === 'chat' && hasUnread && <span className="app-rail-dot" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
