// shell/TitlebarMenu.jsx
// A title-bar drop-down: a trigger label that opens a list of choices, with
// the current one marked. Same look and close-on-mouse-leave behaviour as
// the workspace and model menus in App.js (those still draw their own
// markup; they could move onto this).
import React, { useState } from 'react';

export function TitlebarMenu({ label, title, items, activeId, onSelect, align = 'left', note }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-titlebar-menu" onMouseLeave={() => setOpen(false)}>
      <div className="app-titlebar-menu-trigger" onClick={() => setOpen(o => !o)} title={title}>
        <span className="app-titlebar-title app-titlebar-menu-label">{label} ▾</span>
      </div>
      {open && (
        <div className={`app-titlebar-dropdown${align === 'right' ? ' app-titlebar-dropdown--right' : ''}`}>
          {items.map(item => (
            <div
              key={item.id}
              className={`app-titlebar-dropdown-item${item.id === activeId ? ' active' : ''}`}
              onClick={() => { setOpen(false); onSelect(item.id); }}
            >
              {item.label}
            </div>
          ))}
          {note && <div className="app-titlebar-dropdown-note">{note}</div>}
        </div>
      )}
    </div>
  );
}
