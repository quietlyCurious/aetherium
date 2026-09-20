// operator/chrome/ContactsPanel.jsx
// The Chat panel: the contact list, one conversation, and the seed data
// the demo starts from.

import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — Chat (contacts)
// ─────────────────────────────────────────────────────────────────────────────

function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export const CONTACTS_SEED = [
  {
    id: 'c1',
    name: 'Jordan Blake',
    role: 'Shift Lead',
    unread: true,
    thread: [
      { from: 'them', text: 'Can you check on F2 before you head to break?', time: '2:14 PM' },
    ],
  },
  {
    id: 'c2',
    name: 'Priya Nair',
    role: 'Maintenance',
    unread: true,
    thread: [
      { from: 'them', text: 'Heading over to inspect CB-204 now.', time: '2:01 PM' },
      { from: 'them', text: 'Should have an update in about 15.', time: '2:02 PM' },
    ],
  },
  {
    id: 'c3',
    name: 'Sam Ortiz',
    role: 'Quality',
    unread: false,
    thread: [
      { from: 'me', text: 'Logged the reject-rate note for A1.', time: '1:10 PM' },
      { from: 'them', text: 'Thanks, got it — flagged the lot too.', time: '1:12 PM' },
    ],
  },
  {
    id: 'c4',
    name: 'Night Shift Lead',
    role: 'Shift Lead',
    unread: false,
    thread: [
      { from: 'them', text: 'Handoff notes are in the log — nothing major overnight.', time: '6:02 AM' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Side panel content — Chat / AI, now driven by the RightRail below rather
// than an internal tab bar
// ─────────────────────────────────────────────────────────────────────────────

export function ContactsPanel({ contacts, activeContactId, onSelectContact, onBack, onSendMessage }) {
  const [draft, setDraft] = useState('');
  const activeContact = contacts.find(c => c.id === activeContactId) || null;

  const send = () => {
    const text = draft.trim();
    if (!text || !activeContact) return;
    onSendMessage(activeContact.id, text);
    setDraft('');
  };

  if (!activeContact) {
    return (
      <div className="op-chat-list">
        {contacts.map(c => {
          const lastMessage = c.thread[c.thread.length - 1];
          return (
            <div key={c.id} className="op-contact-row" onClick={() => onSelectContact(c.id)}>
              <div className="op-contact-avatar">{initials(c.name)}</div>
              <div className="op-contact-info">
                <div className="op-contact-name-row">
                  <span className="op-contact-name">{c.name}</span>
                  {c.unread && <span className="op-unread-dot" />}
                </div>
                <div className="op-contact-role">{c.role}</div>
                {lastMessage && <div className="op-contact-preview">{lastMessage.text}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="op-chat-thread">
      <div className="op-chat-thread-header" onClick={onBack}>
        <span className="op-chat-back">←</span>
        <span className="op-contact-name">{activeContact.name}</span>
      </div>
      <div className="op-chat-messages">
        {activeContact.thread.map((m, i) => (
          <div key={i} className={`op-chat-bubble op-chat-bubble--${m.from}`}>
            <div className="op-chat-bubble-text">{m.text}</div>
            <div className="op-chat-bubble-time">{m.time}</div>
          </div>
        ))}
      </div>
      <div className="op-chat-input-row">
        <input
          type="text"
          placeholder={`Message ${activeContact.name.split(' ')[0]}…`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
        />
        <button className="op-btn op-btn--secondary" onClick={send}>Send</button>
      </div>
    </div>
  );
}
