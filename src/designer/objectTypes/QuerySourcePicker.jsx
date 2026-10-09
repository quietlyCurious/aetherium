// designer/objectTypes/QuerySourcePicker.jsx
// Picks one query from a connection's live catalog (useQueryCatalog): a
// single list for an all-at-once source (OpHub flows), or Thing then service
// for a two-step source (ThingWorx). Used for an object type's list query
// and for adding a reference.
//
// `extraOptions` adds non-query choices at the top of the first list, e.g.
// ThingWorx's "Each object is a Thing" — picking one calls onPickExtra.

import { useState } from 'react';
import { SelectBox } from 'devextreme-react/select-box';

const box = { stylingMode: 'outlined', height: 24, searchEnabled: true, showDataBeforeSearch: true };

const itemLabel = (item) => item.definition.name;

export function QuerySourcePicker({ entry, onLoadGroup, value, onPick, extraOptions = [], onPickExtra, placeholder = 'Choose a query…' }) {
  const [groupKey, setGroupKey] = useState(null);
  const groups = entry?.groups || [];

  // All-at-once: every query in one searchable list.
  const flatItems = entry?.lazy ? [] : groups.flatMap(g => g.items.map(item => ({ id: item.sourceKey, label: `${itemLabel(item)}  ·  ${g.label}`, item })))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!entry) return <div className="ot-muted">Choose a connection first.</div>;
  if (entry.status === 'loading') return <div className="ot-muted">Loading…</div>;
  if (entry.status === 'error') return <div className="ot-error">{entry.error}</div>;

  if (!entry.lazy) {
    const items = [...extraOptions.map(o => ({ id: `extra:${o.value}`, label: o.label, extra: o })), ...flatItems];
    return (
      <SelectBox
        {...box}
        dataSource={items}
        valueExpr="id"
        displayExpr="label"
        value={value}
        placeholder={placeholder}
        onValueChanged={e => {
          const picked = items.find(i => i.id === e.value);
          if (!picked) return;
          if (picked.extra) onPickExtra?.(picked.extra.value);
          else onPick(picked.item);
        }}
      />
    );
  }

  // Two-step: a group (Thing), then one of its queries (services).
  const group = groups.find(g => g.key === groupKey);
  const groupItems = [
    ...extraOptions.map(o => ({ id: `extra:${o.value}`, label: o.label, extra: o })),
    ...groups.map(g => ({ id: g.key, label: g.label })),
  ];
  const serviceItems = (group?.items || [])
    .map(item => ({ id: item.sourceKey, label: `${itemLabel(item)}${item.minor ? '  (built-in)' : ''}`, item }))
    .sort((a, b) => (a.item.minor === b.item.minor ? a.label.localeCompare(b.label) : a.item.minor ? 1 : -1));
  return (
    <div className="ot-pair">
      <SelectBox
        {...box}
        dataSource={groupItems}
        valueExpr="id"
        displayExpr="label"
        value={groupKey}
        placeholder="Choose a Thing…"
        onValueChanged={e => {
          const picked = groupItems.find(i => i.id === e.value);
          if (!picked) return;
          if (picked.extra) { setGroupKey(null); onPickExtra?.(picked.extra.value); return; }
          setGroupKey(picked.id);
          const g = groups.find(x => x.key === picked.id);
          if (g && (g.status === 'idle' || g.status === 'error')) onLoadGroup(picked.id);
        }}
      />
      {group && (
        group.status === 'loading' ? <div className="ot-muted">Loading services…</div>
        : group.status === 'error' ? <div className="ot-error">{group.error}</div>
        : (
          <SelectBox
            {...box}
            dataSource={serviceItems}
            valueExpr="id"
            displayExpr="label"
            value={value}
            placeholder="Choose a service…"
            onValueChanged={e => {
              const picked = serviceItems.find(i => i.id === e.value);
              if (picked) onPick(picked.item);
            }}
          />
        )
      )}
    </div>
  );
}

