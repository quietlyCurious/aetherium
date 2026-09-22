// designer/screens/MultiSelectionDetails.jsx
// The details panel when several items are selected: the settings they
// have in common, edited on all of them at once. A field shows a value
// only when every selected item has the same one; otherwise it's blank.
//   Coordinate  when every item sits in a coordinate layout
//   Slot        when every item sits in a flex (or grid) layout — a mix of
//               the two can't be sized together, and says so
//   Box         padding, margin, border, color, type, overflow
//   Properties  the widget properties every selected widget shares (by
//               name), when the selection is all widgets
// Moved out of App.js unchanged.

import { findContainerById } from '../../containerTree';
import { getWidgetPropertyDefs } from '../widgets/widgetPropertyDefs';
import { WidgetPropertyGrid } from '../widgets/WidgetPropertyField';
import { sharedTextField as ti, selectField as sb, overflowField, OverflowWarning } from './detailsFields';

export function MultiSelectionDetails({ editor }) {
  const { containers, selectedContainerIds, isSelectedLocked } = editor;
  const selected = selectedContainerIds
    .map(id => findContainerById(containers, id))
    .filter(Boolean);

  // The value every selected item shares, or undefined when they differ
  const shared = (getter) => {
    const vals = selected.map(getter);
    return vals.every(v => v === vals[0]) ? vals[0] : undefined;
  };

  const updateAllSlot = (slot) => selected.forEach(c => editor.updateSlot(c.id, slot));
  const updateAllCoord = (coord) => selected.forEach(c => editor.updateCoord(c.id, coord));
  const updateAllWidgetProps = (props) => selected.forEach(c => c.isWidget && editor.updateWidgetProps(c.id, props));
  const num = (v) => v === '' ? '' : Number(v);

  const allHaveParent = selected.every(c => c.parentId !== null);

  // Each item's OWN parent decides its layout — the selection can span
  // several parents.
  const isCoordItem = (c) => findContainerById(containers, c.parentId)?.layout?.layoutType === 'coordinate';
  const allCoord = allHaveParent && selected.every(isCoordItem);
  const allFlexLike = allHaveParent && selected.every(c => !isCoordItem(c));
  const mixedLayoutTypes = allHaveParent && !allCoord && !allFlexLike;

  // Widget properties present on EVERY selected widget, matched by name
  const allWidgets = selected.every(c => c.isWidget);
  const sharedWidgetName = shared(c => c.widgetName);
  const sharedPropDefs = (() => {
    if (!allWidgets) return [];
    const propMaps = selected.map(c => {
      const defs = getWidgetPropertyDefs(c.widgetName);
      return new Map(defs.map(p => [p.name, p]));
    });
    if (propMaps.length === 0) return [];
    return [...propMaps[0].values()].filter(p =>
      propMaps.every(m => m.has(p.name))
    );
  })();

  const slotRow = (label, key) => (
    <>
      <span className="details-grid-label">{label}</span>
      <div className="details-grid-control">{ti(shared(c => c.slot?.[key]), '—', v => updateAllSlot({ [key]: v }))}</div>
    </>
  );
  const coordRow = (label, key, numeric) => (
    <>
      <span className="details-grid-label">{label}</span>
      <div className="details-grid-control">{numeric
        ? ti(shared(c => c.coord?.[key]), '—', v => updateAllCoord({ [key]: num(v) }), 'number')
        : ti(shared(c => c.coord?.[key]), '—', v => updateAllCoord({ [key]: v }))}</div>
    </>
  );

  return (
    <div key={selectedContainerIds.join(',')} className={isSelectedLocked ? 'details-locked' : undefined}>
      <div className="details-section">
        <div className="details-grid">
          <span className="details-section-title">{selected.length} items selected</span>
        </div>
      </div>

      {allCoord && (
        <div className="details-section">
          <div className="details-grid">
            <span className="details-section-title">Coordinate</span>
            {coordRow('Left', 'left', true)}
            {coordRow('Right', 'right', true)}
            {coordRow('Top', 'top', true)}
            {coordRow('Bottom', 'bottom', true)}
            {coordRow('Width', 'width', true)}
            {coordRow('Min W', 'minWidth')}
            {coordRow('Max W', 'maxWidth')}
            {coordRow('Height', 'height', true)}
            {coordRow('Min H', 'minHeight')}
            {coordRow('Max H', 'maxHeight')}
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#aaa', fontStyle: 'italic', paddingTop: 2 }}>
              Aspect ratio lock isn't available for multi-select yet.
            </div>
          </div>
        </div>
      )}

      {mixedLayoutTypes && (
        <div className="details-section">
          <div className="details-grid">
            <span className="details-section-title">Slot</span>
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#7a6000', background: '#fffbe6', border: '1px solid #ffe08a', borderRadius: 4, padding: '6px 8px', lineHeight: 1.5 }}>
              This selection mixes coordinate-layout and flex-layout items — position/size editing isn't available together. Select only coordinate items or only flex items to edit dimensions in bulk.
            </div>
          </div>
        </div>
      )}

      {allFlexLike && (
        <div className="details-section">
          <div className="details-grid">
            <span className="details-section-title">Slot</span>
            {slotRow('Width', 'width')}
            {slotRow('Min W', 'minWidth')}
            {slotRow('Max W', 'maxWidth')}
            {slotRow('Height', 'height')}
            {slotRow('Min H', 'minHeight')}
            {slotRow('Max H', 'maxHeight')}
            <span className="details-grid-label">Grow</span>
            <div className="details-grid-control">{sb([0,1,2,3], shared(c => c.slot?.flexGrow), v => updateAllSlot({ flexGrow: v }))}</div>
            <span className="details-grid-label">Shrink</span>
            <div className="details-grid-control">{sb([0,1,2,3], shared(c => c.slot?.flexShrink), v => updateAllSlot({ flexShrink: v }))}</div>
          </div>
        </div>
      )}

      {allHaveParent && (
        <div className="details-section">
          <div className="details-grid">
            <span className="details-section-title">Box</span>
            {slotRow('Pad Top', 'paddingTop')}
            {slotRow('Pad Bottom', 'paddingBottom')}
            {slotRow('Pad Left', 'paddingLeft')}
            {slotRow('Pad Right', 'paddingRight')}
            {slotRow('Margin Top', 'marginTop')}
            {slotRow('Margin Bottom', 'marginBottom')}
            {slotRow('Margin Left', 'marginLeft')}
            {slotRow('Margin Right', 'marginRight')}
            {slotRow('Border Width', 'borderWidth')}
            <span className="details-grid-label">Border Style</span>
            <div className="details-grid-control">{sb(['','solid','dashed','dotted','double','none'], shared(c => c.slot?.borderStyle), v => updateAllSlot({ borderStyle: v }))}</div>
            {slotRow('Border Color', 'borderColor')}
            {slotRow('Border Radius', 'borderRadius')}
            {slotRow('Bg Color', 'backgroundColor')}
            {slotRow('Text Color', 'color')}
            {slotRow('Font Size', 'fontSize')}
            <span className="details-grid-label">Font Weight</span>
            <div className="details-grid-control">{sb(['','normal','bold','300','400','500','600','700'], shared(c => c.slot?.fontWeight), v => updateAllSlot({ fontWeight: v }))}</div>
            <span className="details-grid-label">Text Align</span>
            <div className="details-grid-control">{sb(['','left','center','right','justify'], shared(c => c.slot?.textAlign), v => updateAllSlot({ textAlign: v }))}</div>
            <span className="details-grid-label">Overflow X</span>
            <div className="details-grid-control">{overflowField(shared(c => c.slot?.overflowX), v => updateAllSlot({ overflowX: v }))}</div>
            <span className="details-grid-label">Overflow Y</span>
            <div className="details-grid-control">{overflowField(shared(c => c.slot?.overflowY), v => updateAllSlot({ overflowY: v }))}</div>
            {(shared(c => c.slot?.overflowX) === 'visible' || shared(c => c.slot?.overflowY) === 'visible') && <OverflowWarning plural />}
          </div>
        </div>
      )}

      {sharedPropDefs.length > 0 && (
        <div className="details-section">
          <WidgetPropertyGrid
            title={sharedWidgetName ? `${sharedWidgetName} Properties` : 'Shared Widget Properties'}
            defs={sharedPropDefs}
            renderControl={(p) => {
              // Blank when the selected widgets disagree (sharedTextField).
              const sharedVal = shared(c => c.widgetProps?.[p.name]);
              const set = v => updateAllWidgetProps({ [p.name]: v });
              if (p.type === 'bool') return sb([{ v: true, l: 'true' }, { v: false, l: 'false' }], sharedVal, set);
              if (p.type === 'enum') return sb(p.options, sharedVal, set);
              if (p.type === 'number') return ti(sharedVal, '—', set, 'number');
              if (p.type === 'string' || p.type === 'color') return ti(sharedVal, '—', set);
              return null; // 'data' — bind-only, and bindings are per widget
            }}
          />
        </div>
      )}
    </div>
  );
}
