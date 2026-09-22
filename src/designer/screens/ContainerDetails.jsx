// designer/screens/ContainerDetails.jsx
// The details panel when one container or widget is selected: a tab per
// area of its settings.
//   <widget name>  the widget's own properties, each bindable (⚡)
//   Layout         how a container lays out its children (not widgets)
//   Slot           its size and place inside its parent — flex, or
//                  coordinate offsets when the parent is a coordinate layout
//   Box            padding, margin, border, overflow, background, type
//   General        name, lock, parent; page type for the root; and in a
//                  breakpoint tier, visibility and clearing its overrides
// In a breakpoint tier other than the base, Slot shows and edits that
// tier's overrides (useScreenEditor.updateSlot sends them there).
//
// The TabPanelItems stay here, directly under TabPanel — DevExtreme finds
// its items among TabPanel's own children — and each tab's contents is a
// component below. Moved out of App.js unchanged.

import React from 'react';
import { SelectBox, TabPanel } from 'devextreme-react';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import { DEFAULT_LAYOUT, DEFAULT_SLOT, DEFAULT_COORD, ROOT_CONTAINER_ID, BASE_TIER_ID, toHtmlId } from '../../containerModel';
import { flattenContainers, findContainerById } from '../../containerTree';
import { getTierById } from '../../breakpointConfig';
import { getWidgetPropertyDefs, useWidgetPropertyOverrides } from '../widgets/widgetPropertyDefs';
import { WidgetPropertyField, WidgetPropertyGrid } from '../widgets/WidgetPropertyField';
import { evaluateExpression } from '../../expressionEval';
import { buildDefaultCells, migrateGridCells } from '../../GridEditor';
import { textField as ti, selectField as sb, overflowField, OverflowWarning } from './detailsFields';
import { describeAssetBinding, PATH_ERRORS } from '../../model/assetPaths';
import { CURRENT_ASSET_MAP } from '../../model/modelData';
import { assetBindingProblem } from './widgetBindings';
import { assetBindingsOf } from './screenAsset';
import { typeOptions } from '../modelOptions';

// Float w/h ratios. null = Free (no constraint).
const ASPECT_RATIO_PRESETS = [
  { label: 'Free',     value: null   },
  { label: '1 : 1',   value: 1      },
  { label: '4 : 3',   value: 4 / 3  },
  { label: '3 : 2',   value: 3 / 2  },
  { label: '16 : 9',  value: 16 / 9 },
  { label: '16 : 10', value: 16 / 10 },
  { label: '2 : 1',   value: 2      },
  { label: '9 : 16',  value: 9 / 16 },
  { label: '3 : 4',   value: 3 / 4  },
  { label: '2 : 3',   value: 2 / 3  },
];
// Shown in the dropdown when the current ratio doesn't match any preset
const CUSTOM_RATIO_SENTINEL = -1;

// What a binding shows in place of the static input. A query binding
// names its instance and fields; an expression shows its current value; an
// asset binding shows its path and what it resolves to for the asset the
// screen is previewing (or why it can't).
function describeBinding(binding, editor, queries, self, isCollection) {
  if (binding?.type === 'asset') {
    const where = describeAssetBinding(binding);
    if (!self?.assetId) {
      return { text: where, title: `Asset: ${where}\nThis screen isn't showing an asset — set what it's about in the Page details.`, isErr: true };
    }
    const assetName = CURRENT_ASSET_MAP[self.assetId]?.name || self.assetId;
    const problem = assetBindingProblem(binding, self.assetId, isCollection);
    if (problem) {
      return { text: `${where} — ${PATH_ERRORS[problem]}`, title: `Asset: ${where}\nOn ${assetName}: ${PATH_ERRORS[problem]}.`, isErr: true };
    }
    return { text: where, title: `Asset: ${where}\nResolves on ${assetName}.`, isErr: false };
  }
  if (binding?.type === 'query') {
    const boundInst = editor.findQueryInstance(binding.queryInstanceId);
    const boundQuery = boundInst ? queries.find(qq => qq.id === boundInst.queryId) : null;
    const instLabel = boundInst?.alias || boundQuery?.name || null;
    // Scalar bindings set outputField (one string); collection bindings set
    // outputFields (an array — possibly EMPTY, which means "all fields").
    const hasScalarField = !!binding.outputField;
    const hasCollectionFields = Array.isArray(binding.outputFields);
    if (instLabel && (hasScalarField || hasCollectionFields)) {
      const rowPick = binding.transform?.find(t => t.type === 'pickRow');
      const fieldsLabel = hasCollectionFields
        ? (binding.outputFields.length === 0 ? 'all fields' : binding.outputFields.map(f => f.fieldName).join(', '))
        : binding.outputField;
      return {
        text: `${instLabel} → ${fieldsLabel}` + (rowPick ? ` (${rowPick.mode} row)` : ''),
        title: `Query: ${instLabel} → ${fieldsLabel}`,
        isErr: false,
      };
    }
    return {
      text: '(query or output no longer exists)',
      title: 'The bound query instance or output field could not be found.',
      isErr: true,
    };
  }
  if (binding?.expression) {
    const resolvedVal = evaluateExpression(binding.expression);
    return { text: String(resolvedVal ?? ''), title: `Expression: ${binding.expression}`, isErr: resolvedVal === '#ERR' };
  }
  return { text: '', title: '', isErr: false };
}

function WidgetPropertiesTab({ editor, queries, self, container, lockedClass }) {
  const { selectedContainerId, bindingPopoverProp } = editor;
  const propDefs = getWidgetPropertyDefs(container.widgetName);
  const props = container.widgetProps || {};
  const bindings = container.bindings || {};
  const setProp = (name, value) => editor.updateWidgetProps(selectedContainerId, { [name]: value });
  const renderControl = (p) => {
    const binding = bindings[p.name];
    const isBound = !!binding;
    const isOpen = bindingPopoverProp?.containerId === selectedContainerId && bindingPopoverProp?.propName === p.name;
    const { text: bindingDisplayText, title: bindingTitle, isErr } = describeBinding(binding, editor, queries, self, p.type === 'data');
    return (
      <div style={{ display: 'flex', gap: 3, alignItems: 'center', width: '100%', minWidth: 0 }}>
        {isBound ? (
          <div
            className={`binding-value-display${isErr ? ' binding-value-display--error' : ''}`}
            title={bindingTitle}
            style={{ flex: 1, minWidth: 0 }}
          >
            ⚡ {bindingDisplayText}
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <WidgetPropertyField def={p} value={props[p.name]} onChange={(value) => setProp(p.name, value)} />
          </div>
        )}
        {p.bindable !== false && (
          <button
            className={`binding-icon-btn${isBound ? ' binding-icon-btn--active' : ''}`}
            title={isBound ? `Edit binding: ${bindingTitle}` : 'Bind this property'}
            onClick={(e) => {
              e.stopPropagation();
              if (isOpen) { editor.setBindingPopoverProp(null); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              editor.setBindingPopoverProp({ containerId: selectedContainerId, propName: p.name, x: rect.left, y: rect.top });
            }}
          >⚡</button>
        )}
      </div>
    );
  };
  return (
    <div className={`details-tab-content${lockedClass}`}>
      <div className="details-section">
        <WidgetPropertyGrid title={container.widgetName} defs={propDefs} renderControl={renderControl} />
      </div>
    </div>
  );
}

function LayoutTab({ editor, layout, lockedClass }) {
  const id = editor.selectedContainerId;
  const set = (update) => editor.updateLayout(id, update);
  // Changing the column or row count also remaps the cells, so merged
  // cells and their contents land in the right places.
  const resizeGrid = (cols, rows) => {
    const oldCells = layout.gridCells || buildDefaultCells(layout.gridColumns||2, layout.gridRows||2);
    return migrateGridCells(oldCells, layout.gridColumns||2, layout.gridRows||2, cols, rows);
  };
  return (
    <div className={`details-tab-content${lockedClass}`}>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Layout</span>
        <span className="details-grid-label">Type</span><div className="details-grid-control">{sb(['flex','coordinate','grid'],layout.layoutType,v=>set({layoutType:v}))}</div>
        {layout.layoutType === 'grid' ? (<>
          <span className="details-grid-label">Columns</span><div className="details-grid-control">{ti(layout.gridColumns, '2', v => {
            const newCols = Math.max(1, parseInt(v)||2);
            set({ gridColumns: newCols, gridCells: resizeGrid(newCols, layout.gridRows||2) });
          }, 'number')}</div>
          <span className="details-grid-label">Rows</span><div className="details-grid-control">{ti(layout.gridRows, '2', v => {
            const newRows = Math.max(1, parseInt(v)||2);
            set({ gridRows: newRows, gridCells: resizeGrid(layout.gridColumns||2, newRows) });
          }, 'number')}</div>
          <span className="details-grid-label">Gap</span><div className="details-grid-control">{ti(layout.gridGap,'8px',v=>set({gridGap:v}))}</div>
          <span className="details-grid-label">Direction</span><div className="details-grid-control">{sb(['horizontal','vertical'], layout.gridMergeDirection || 'horizontal', v => set({ gridMergeDirection: v }))}</div>
        </>) : layout.layoutType === 'flex' ? (<>
          <span className="details-grid-label">Direction</span><div className="details-grid-control">{sb(['row','column','row-reverse','column-reverse'],layout.flexDirection,v=>set({flexDirection:v}))}</div>
          <span className="details-grid-label">Wrap</span><div className="details-grid-control">{sb(['no wrap','wrap','wrap-reverse'],layout.flexWrap,v=>set({flexWrap:v}))}</div>
          <span className="details-grid-label">Justify</span><div className="details-grid-control">{sb(['flex-start','flex-end','center','space-between','space-around'],layout.justifyContent,v=>set({justifyContent:v}))}</div>
          <span className="details-grid-label">Align</span><div className="details-grid-control">{sb(['flex-start','flex-end','center','baseline','stretch'],layout.alignItems,v=>set({alignItems:v}))}</div>
        </>) : null}
      </div></div>
    </div>
  );
}

// The Ratio row, shared by the coordinate and flex versions of the Slot tab.
function AspectRatioRow({ editor, container, parentContainer, slot }) {
  const id = editor.selectedContainerId;
  const currentAr = container.aspectRatio ?? null;
  const arPresetMatch = currentAr !== null
    ? ASPECT_RATIO_PRESETS.find(p => p.value !== null && Math.abs(p.value - currentAr) < 0.001)
    : null;
  const arSelectValue = currentAr === null
    ? null
    : (arPresetMatch ? arPresetMatch.value : CUSTOM_RATIO_SENTINEL);
  const arDataSource = currentAr !== null && !arPresetMatch
    ? [...ASPECT_RATIO_PRESETS, { label: '🔒 Custom', value: CUSTOM_RATIO_SENTINEL }]
    : ASPECT_RATIO_PRESETS;

  // 🔗 locks the ratio at the current width and height, when both are
  // concrete numbers (px for a flex child).
  const lockCurrentRatio = () => {
    const isCoordChild = parentContainer?.layout?.layoutType === 'coordinate';
    let w, h;
    if (isCoordChild) {
      w = container.coord?.width;
      h = container.coord?.height;
      if (typeof w !== 'number' || typeof h !== 'number' || h === 0) return;
    } else {
      if (!slot?.width?.endsWith?.('px') || !slot?.height?.endsWith?.('px')) return;
      w = parseFloat(slot.width);
      h = parseFloat(slot.height);
      if (isNaN(w) || isNaN(h) || h === 0) return;
    }
    editor.setContainerAspectRatio(id, w / h);
  };

  return (
    <>
      <span className="details-grid-label">Ratio</span>
      <div className="details-grid-control" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <SelectBox
          dataSource={arDataSource}
          valueExpr="value"
          displayExpr="label"
          value={arSelectValue}
          onValueChanged={(e) => {
            if (e.value === CUSTOM_RATIO_SENTINEL) return;
            editor.setContainerAspectRatio(id, e.value);
          }}
          stylingMode="outlined"
          width="100%"
          height={24}
        />
        <button className="focus-mode-btn" title="Lock at current dimensions" style={{ flexShrink: 0, padding: '0 6px', fontSize: 14 }} onClick={lockCurrentRatio}>🔗</button>
      </div>
    </>
  );
}

const derivedStyle = { fontSize: 11, color: '#888', padding: '2px 6px', background: '#f5f5f5', borderRadius: 4, border: '1px solid #e0e0e0', height: 24, display: 'flex', alignItems: 'center', fontStyle: 'italic' };

function SlotTab({ editor, container, parentContainer, slot, isBase, tier, overrides, lockedClass }) {
  const id = editor.selectedContainerId;
  const setSlot = (update) => editor.updateSlot(id, update);
  const setCoord = (update) => editor.updateCoord(id, update);
  const coord = container.coord || DEFAULT_COORD;
  const num = (v) => v === '' ? '' : Number(v);
  // Stretch = both edges on an axis are set, so that axis's size is
  // derived from them rather than typed in.
  const coordIsSet = (v) => v !== '' && v !== undefined && v !== null;
  const isStretchX = coordIsSet(coord.left) && coordIsSet(coord.right);
  const isStretchY = coordIsSet(coord.top)  && coordIsSet(coord.bottom);
  const ratioRow = <AspectRatioRow editor={editor} container={container} parentContainer={parentContainer} slot={slot} />;

  return (
    <div className={`details-tab-content${lockedClass}`}>
      {!isBase && overrides.slot && Object.keys(overrides.slot).length > 0 && (
        <div style={{ padding: '4px 8px', fontSize: 10, background: tier?.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{tier?.icon} {tier?.label} size overrides active</span>
          <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => editor.clearBreakpointOverrides(id, editor.activeTierId)}>clear</span>
        </div>
      )}
      {parentContainer.layout?.layoutType === 'coordinate' ? (
        <div className="details-section"><div className="details-grid">
          <span className="details-section-title">Coordinate</span>
          <span className="details-grid-label">Unit</span><div className="details-grid-control">{sb(['px','%'], coord.unit, v => setCoord({unit:v}))}</div>
          <span className="details-grid-label">Left</span><div className="details-grid-control">{ti(coord.left,'—',v=>setCoord({left:num(v)}),'number')}</div>
          <span className="details-grid-label">Right</span><div className="details-grid-control">{ti(coord.right,'—',v=>setCoord({right:num(v)}),'number')}</div>
          <span className="details-grid-label">Top</span><div className="details-grid-control">{ti(coord.top,'—',v=>setCoord({top:num(v)}),'number')}</div>
          <span className="details-grid-label">Bottom</span><div className="details-grid-control">{ti(coord.bottom,'—',v=>setCoord({bottom:num(v)}),'number')}</div>
          <span className="details-grid-label">Width</span>
          <div className="details-grid-control">
            {isStretchX ? (
              <div style={derivedStyle}>derived</div>
            ) : (
              ti(coord.width,'—',v=>setCoord({width:num(v)}),'number')
            )}
          </div>
          <span className="details-grid-label">Height</span>
          <div className="details-grid-control">
            {isStretchY ? (
              <div style={derivedStyle}>derived</div>
            ) : (
              ti(coord.height,'—',v=>setCoord({height:num(v)}),'number')
            )}
          </div>
          {(isStretchX || isStretchY) && (
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#0055aa', background: '#e8f2ff', border: '1px solid #b3d0ff', padding: '5px 8px', borderRadius: 4, margin: '2px 0', lineHeight: 1.5 }}>
              {isStretchX && isStretchY
                ? '↔↕ Width and height are derived from offset pairs.'
                : isStretchX
                  ? '↔ Width is derived — set by Left + Right offsets.'
                  : '↕ Height is derived — set by Top + Bottom offsets.'}
              {' '}Clear one offset to restore a fixed size.
            </div>
          )}
          <span className="details-grid-label">Min W</span><div className="details-grid-control">{ti(coord.minWidth,'—',v=>setCoord({minWidth:v}))}</div>
          <span className="details-grid-label">Max W</span><div className="details-grid-control">{ti(coord.maxWidth,'—',v=>setCoord({maxWidth:v}))}</div>
          <span className="details-grid-label">Min H</span><div className="details-grid-control">{ti(coord.minHeight,'—',v=>setCoord({minHeight:v}))}</div>
          <span className="details-grid-label">Max H</span><div className="details-grid-control">{ti(coord.maxHeight,'—',v=>setCoord({maxHeight:v}))}</div>
          {ratioRow}
        </div></div>
      ) : (
       <div className="details-section"><div className="details-grid">
          <span className="details-section-title">Slot</span>
          <span className="details-grid-label">Grow</span><div className="details-grid-control">{sb([0,1,2,3],slot.flexGrow,v=>setSlot({flexGrow:v}))}</div>
          <span className="details-grid-label">Shrink</span><div className="details-grid-control">{sb([0,1,2,3],slot.flexShrink,v=>setSlot({flexShrink:v}))}</div>
          <span className="details-grid-label">Basis</span><div className="details-grid-control">{ti(slot.flexBasis,'auto',v=>setSlot({flexBasis:v}))}</div>
          <span className="details-grid-label">Align Self</span><div className="details-grid-control">{sb(['auto','flex-start','flex-end','center','baseline','stretch'],slot.alignSelf,v=>setSlot({alignSelf:v}))}</div>
          <span className="details-grid-label">Order</span><div className="details-grid-control">{ti(slot.order,'0',v=>setSlot({order:v}),'number')}</div>
          <span className="details-grid-label">Width</span><div className="details-grid-control">{ti(slot.width,'auto',v=>setSlot({width:v}))}</div>
          <span className="details-grid-label">Min W</span><div className="details-grid-control">{ti(slot.minWidth,'0',v=>setSlot({minWidth:v}))}</div>
          <span className="details-grid-label">Max W</span><div className="details-grid-control">{ti(slot.maxWidth,'none',v=>setSlot({maxWidth:v}))}</div>
          <span className="details-grid-label">Height</span><div className="details-grid-control">{ti(slot.height,'auto',v=>setSlot({height:v}))}</div>
          <span className="details-grid-label">Min H</span><div className="details-grid-control">{ti(slot.minHeight,'0',v=>setSlot({minHeight:v}))}</div>
          <span className="details-grid-label">Max H</span><div className="details-grid-control">{ti(slot.maxHeight,'none',v=>setSlot({maxHeight:v}))}</div>
          {ratioRow}
        </div></div>
      )}
    </div>
  );
}

function BoxTab({ editor, slot, lockedClass }) {
  const setSlot = (update) => editor.updateSlot(editor.selectedContainerId, update);
  return (
    <div className={`details-tab-content${lockedClass}`}>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Padding</span>
        <span className="details-grid-label">Top</span><div className="details-grid-control">{ti(slot.paddingTop,'0',v=>setSlot({paddingTop:v}))}</div>
        <span className="details-grid-label">Bottom</span><div className="details-grid-control">{ti(slot.paddingBottom,'0',v=>setSlot({paddingBottom:v}))}</div>
        <span className="details-grid-label">Left</span><div className="details-grid-control">{ti(slot.paddingLeft,'0',v=>setSlot({paddingLeft:v}))}</div>
        <span className="details-grid-label">Right</span><div className="details-grid-control">{ti(slot.paddingRight,'0',v=>setSlot({paddingRight:v}))}</div>
      </div></div>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Margin</span>
        <span className="details-grid-label">Top</span><div className="details-grid-control">{ti(slot.marginTop,'0',v=>setSlot({marginTop:v}))}</div>
        <span className="details-grid-label">Bottom</span><div className="details-grid-control">{ti(slot.marginBottom,'0',v=>setSlot({marginBottom:v}))}</div>
        <span className="details-grid-label">Left</span><div className="details-grid-control">{ti(slot.marginLeft,'0',v=>setSlot({marginLeft:v}))}</div>
        <span className="details-grid-label">Right</span><div className="details-grid-control">{ti(slot.marginRight,'0',v=>setSlot({marginRight:v}))}</div>
      </div></div>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Border</span>
        <span className="details-grid-label">Width</span><div className="details-grid-control">{ti(slot.borderWidth,'1px',v=>setSlot({borderWidth:v}))}</div>
        <span className="details-grid-label">Style</span><div className="details-grid-control">{sb(['','solid','dashed','dotted','double','none'],slot.borderStyle,v=>setSlot({borderStyle:v}))}</div>
        <span className="details-grid-label">Color</span><div className="details-grid-control">{ti(slot.borderColor,'#e0e0e0',v=>setSlot({borderColor:v}))}</div>
        <span className="details-grid-label">Radius</span><div className="details-grid-control">{ti(slot.borderRadius,'0',v=>setSlot({borderRadius:v}))}</div>
      </div></div>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Content</span>
        <span className="details-grid-label">Overflow X</span>
        <div className="details-grid-control">{overflowField(slot?.overflowX, v => setSlot({ overflowX: v }))}</div>
        <span className="details-grid-label">Overflow Y</span>
        <div className="details-grid-control">{overflowField(slot?.overflowY, v => setSlot({ overflowY: v }))}</div>
        {(slot?.overflowX === 'visible' || slot?.overflowY === 'visible') && <OverflowWarning />}
      </div></div>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Background</span>
        <span className="details-grid-label">Color</span><div className="details-grid-control">{ti(slot.backgroundColor,'',v=>setSlot({backgroundColor:v}))}</div>
        <span className="details-grid-label">Image</span><div className="details-grid-control">{ti(slot.backgroundImage,'url(...)',v=>setSlot({backgroundImage:v}))}</div>
        <span className="details-grid-label">Size</span><div className="details-grid-control">{sb(['','cover','contain','auto','100% 100%'],slot.backgroundSize,v=>setSlot({backgroundSize:v}))}</div>
        <span className="details-grid-label">Position</span><div className="details-grid-control">{sb(['','center','top','bottom','left','right','top left','top right','bottom left','bottom right'],slot.backgroundPosition,v=>setSlot({backgroundPosition:v}))}</div>
        <span className="details-grid-label">Repeat</span><div className="details-grid-control">{sb(['','no-repeat','repeat','repeat-x','repeat-y'],slot.backgroundRepeat,v=>setSlot({backgroundRepeat:v}))}</div>
      </div></div>
      <div className="details-section"><div className="details-grid">
        <span className="details-section-title">Typography</span>
        <span className="details-grid-label">Color</span><div className="details-grid-control">{ti(slot.color,'inherit',v=>setSlot({color:v}))}</div>
        <span className="details-grid-label">Font Size</span><div className="details-grid-control">{ti(slot.fontSize,'',v=>setSlot({fontSize:v}))}</div>
        <span className="details-grid-label">Font Weight</span><div className="details-grid-control">{sb(['','normal','bold','100','200','300','400','500','600','700','800','900'],slot.fontWeight,v=>setSlot({fontWeight:v}))}</div>
        <span className="details-grid-label">Font Family</span><div className="details-grid-control">{ti(slot.fontFamily,'',v=>setSlot({fontFamily:v}))}</div>
        <span className="details-grid-label">Line Height</span><div className="details-grid-control">{ti(slot.lineHeight,'',v=>setSlot({lineHeight:v}))}</div>
        <span className="details-grid-label">Text Align</span><div className="details-grid-control">{sb(['','left','center','right','justify'],slot.textAlign,v=>setSlot({textAlign:v}))}</div>
        <span className="details-grid-label">Letter Spacing</span><div className="details-grid-control">{ti(slot.letterSpacing,'',v=>setSlot({letterSpacing:v}))}</div>
      </div></div>
    </div>
  );
}

// What the page is about: none (a plain page) or a type from the loaded
// model. Changing it checks the page's asset bindings first (see
// screenSelfOf.changeType).
function PageAboutField({ self, containers }) {
  const NONE = '__none__';
  const bindingCount = assetBindingsOf(containers).length;
  const options = [{ id: NONE, name: 'Nothing (a plain page)', level: '' }, ...typeOptions()];
  const known = self.status === 'ok' || self.status === 'none';
  // Bumped when a change is cancelled, so the box shows the old type again.
  const [revision, setRevision] = React.useState(0);
  return (<>
    <span className="details-grid-label">About</span>
    <div className="details-grid-control" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
      <SelectBox
        key={revision}
        dataSource={options}
        valueExpr="id"
        displayExpr="name"
        value={known ? (self.typeId || NONE) : null}
        placeholder={known ? '' : (self.status === 'otherModel' ? `A type in “${self.context?.modelId}”` : 'A type this model doesn’t have')}
        searchEnabled
        itemRender={t => <span>{t.name}{t.level && <span style={{ color: '#999' }}> · {t.level}</span>}</span>}
        onValueChanged={e => {
          if (!e.value) return;
          if (!self.changeType(e.value === NONE ? null : e.value)) setRevision(n => n + 1);
        }}
        stylingMode="outlined"
        width="100%"
        height={24}
      />
      <span style={{ fontSize: 10, color: '#888', lineHeight: 1.4 }}>
        {self.typeId
          ? `Bind widgets to this ${self.typeLabel || 'asset'}'s properties with ⚡ → Asset.${bindingCount ? ` ${bindingCount} asset binding${bindingCount === 1 ? '' : 's'} on this page.` : ''}`
          : 'Make this a screen about one type of asset, drawn for any asset of that type.'}
      </span>
    </div>
  </>);
}

function GeneralTab({ editor, self, container, title, parentContainer, isBase, tier, isHidden, hasOverrides, lockedClass }) {
  const id = editor.selectedContainerId;
  return (
    <div className="details-tab-content">
      {/* Visibility — shown in non-base tiers */}
      {!isBase && (
        <div className={`details-section${lockedClass}`}>
          <div className="details-grid">
            <span className="details-section-title" style={{ color: tier?.color }}>
              {tier?.icon} {tier?.label} Visibility
            </span>
            <span className="details-grid-label">Visible</span>
            <div className="details-grid-control">
              <button
                className={`focus-mode-btn${isHidden ? '' : ' focus-mode-btn--active'}`}
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => editor.toggleVisibility(id, editor.activeTierId)}
              >
                {isHidden ? '👁 Hidden' : '👁 Visible'}
              </button>
            </div>
            {hasOverrides && (
              <>
                <span className="details-grid-label">Overrides</span>
                <div className="details-grid-control">
                  <button className="focus-mode-btn" style={{ color: '#d00', borderColor: '#d00', width: '100%', fontSize: 10 }}
                    onClick={() => editor.clearBreakpointOverrides(id, editor.activeTierId)}>
                    Clear {tier?.label} overrides
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="details-section">
        <div className="details-grid">
          <span className="details-section-title">Identity</span>
          <span className="details-grid-label">Name</span>
          <div className={`details-grid-control${lockedClass}`}>
            <input className="details-input" value={title} onChange={(e) => { const s = toHtmlId(e.target.value); if (s) editor.renameContainer(id, s); }} />
          </div>
          {container.id !== ROOT_CONTAINER_ID && (<>
            <span className="details-grid-label">Lock</span>
            <div className="details-grid-control">
              <button
                className={`focus-mode-btn${container.locked ? ' focus-mode-btn--active' : ''}`}
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => editor.toggleContainerLock(id)}
              >
                {container.locked ? '🔒 Locked' : '🔓 Unlocked'}
              </button>
            </div>
          </>)}
          {parentContainer && (<>
            <span className="details-grid-label">Parent</span>
            <div className="details-grid-control"><span style={{ fontSize: 11, color: '#555' }}>{parentContainer.title}</span></div>
            <span className="details-grid-label">Parent Layout</span>
            <div className="details-grid-control"><span style={{ fontSize: 11, color: parentContainer.layout?.layoutType === 'coordinate' ? '#0078d4' : '#555', fontWeight: 600 }}>{parentContainer.layout?.layoutType || 'flex'}</span></div>
          </>)}
        </div>
      </div>
      {container.id === ROOT_CONTAINER_ID && (
        <div className="details-section">
          <div className="details-grid">
            <span className="details-section-title">Page</span>
            <span className="details-grid-label">Type</span>
            <div className="details-grid-control">{sb(['fit','fixed','vertical fixed','horizontal fixed'], container.pageType || 'fit', v => editor.updatePageType(id, v))}</div>
            <PageAboutField self={self} containers={editor.containers} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ContainerDetails({ editor, queries, self }) {
  useWidgetPropertyOverrides(); // re-render if the Widgets area saves a change
  const { containers, selectedContainerId, activeTierId } = editor;
  const flat = flattenContainers(containers);
  const found = flat.find(c => c.id === selectedContainerId);
  const container = found ? findContainerById(containers, selectedContainerId) : null;
  if (!found || !container) return null;

  // What the selected tier shows: the base values with that tier's
  // overrides on top.
  const isBase = activeTierId === BASE_TIER_ID;
  const tier = getTierById(activeTierId);
  const overrides = container.breakpointOverrides?.[activeTierId] || {};
  const isHidden = overrides.hidden ?? false;
  const hasOverrides = Object.keys(container.breakpointOverrides || {}).some(t => {
    const o = container.breakpointOverrides[t];
    return Object.keys(o).length > 0;
  });
  const layout = container.layout || DEFAULT_LAYOUT;
  const baseSlot = container.slot || DEFAULT_SLOT;
  const slot = isBase ? baseSlot : { ...baseSlot, ...(overrides.slot || {}) };
  const parentContainer = container.parentId !== null
    ? findContainerById(containers, container.parentId)
    : null;
  const lockedClass = editor.isSelectedLocked ? ' details-locked' : '';
  const widgetPropDefs = container.isWidget && container.widgetName ? getWidgetPropertyDefs(container.widgetName) : null;

  return (
    <div key={selectedContainerId} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TabPanel
        height="100%"
        animationEnabled={false}
        swipeEnabled={false}
        selectedIndex={editor.detailsTabIndex}
        onSelectedIndexChange={editor.setDetailsTabIndex}
      >
        {widgetPropDefs && widgetPropDefs.length > 0 && (
          <TabPanelItem title={container.widgetName}>
            <WidgetPropertiesTab editor={editor} queries={queries} self={self} container={container} lockedClass={lockedClass} />
          </TabPanelItem>
        )}

        {!container.isWidget && container.id !== ROOT_CONTAINER_ID && (
          <TabPanelItem title="Layout">
            <LayoutTab editor={editor} layout={layout} lockedClass={lockedClass} />
          </TabPanelItem>
        )}

        {parentContainer && (
          <TabPanelItem title="Slot">
            <SlotTab
              editor={editor} container={container} parentContainer={parentContainer} slot={slot}
              isBase={isBase} tier={tier} overrides={overrides} lockedClass={lockedClass}
            />
          </TabPanelItem>
        )}

        {container.id !== ROOT_CONTAINER_ID && (
          <TabPanelItem title="Box">
            <BoxTab editor={editor} slot={slot} lockedClass={lockedClass} />
          </TabPanelItem>
        )}

        {/* General — always last */}
        <TabPanelItem title="General">
          <GeneralTab
            editor={editor} self={self} container={container} title={found.title} parentContainer={parentContainer}
            isBase={isBase} tier={tier} isHidden={isHidden} hasOverrides={hasOverrides} lockedClass={lockedClass}
          />
        </TabPanelItem>
      </TabPanel>
    </div>
  );
}
