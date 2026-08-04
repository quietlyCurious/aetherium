// FormFields.jsx
// Shared, presentation-only field primitives for the system-scoped definition workspaces
// (Data Sources, Queries, Scripts). Pulled out of DataSourcesWorkspace.jsx so the same
// label/control grid pattern isn't reimplemented per-workspace — extend here, not in callers.

import React from 'react';

// One label + control row inside a `.details-grid` two-column grid.
export function Field({ label, children }) {
  return (
    <>
      <span className="details-grid-label">{label}</span>
      <div className="details-grid-control">{children}</div>
    </>
  );
}

// Plain text input matching the `.details-input` visual style used throughout Aetherium.
export function TxtInput({ value = '', placeholder = '', onChange, mono = false }) {
  return (
    <input
      className="details-input"
      value={value ?? ''}
      placeholder={placeholder}
      style={mono ? { fontFamily: 'Consolas, Monaco, monospace', fontSize: 11 } : undefined}
      onChange={e => onChange(e.target.value)}
    />
  );
}

// Small italic helper/explanatory line spanning the full grid width.
export function InfoNote({ children }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      fontSize: 10,
      color: '#888',
      fontStyle: 'italic',
      padding: '2px 0 2px 2px',
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

// Top-level section heading (e.g. "General", "Connectivity") spanning the full grid width.
export function SectionTitle({ children }) {
  return (
    <span className="details-section-title" style={{ gridColumn: '1 / -1' }}>{children}</span>
  );
}

// Smaller uppercase sub-heading used to divide a section into logical groups
// (e.g. "Connectivity" vs "Authentication" within one Connectivity section).
export function SubSectionLabel({ children }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      fontSize: 10,
      fontWeight: 700,
      color: '#555',
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      paddingTop: 10,
      paddingBottom: 4,
      borderBottom: '1px solid #ebebeb',
    }}>
      {children}
    </div>
  );
}
