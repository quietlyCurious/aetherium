// designer/screens/LayoutPresets.jsx
// The Quick presets block at the top of the Layout tab — see
// layoutPresetMapping.js. Drawn with the Visualization toolbar's own button
// groups and icons, so the same choice looks the same in both places.

import { ButtonGroup, Item as ButtonGroupItem } from 'devextreme-react/button-group';
import { IconButtonGroupItem } from '../../operator/icons';
import { ALIGN_CONTENT_ITEMS, FLOW_DIRECTION_ITEMS, FLOW_WRAP_ITEMS } from '../../operator/settings/layoutOptions';
import { ARRANGE_ITEMS, layoutPresetState, layoutUpdateForPreset } from './layoutPresetMapping';

function PresetGroup({ items, selected, onPick, icons }) {
  return (
    <ButtonGroup
      keyExpr="value"
      selectedItemKeys={selected ? [selected] : []}
      onItemClick={e => onPick(e.itemData.value)}
      stylingMode="outlined"
      className="op-dash-chart-toggle layout-preset-group"
    >
      {items.map(item => (
        <ButtonGroupItem
          key={item.value}
          text={item.text}
          value={item.value}
          hint={item.text}
          render={icons && item.Icon ? () => <IconButtonGroupItem {...item} /> : undefined}
        />
      ))}
    </ButtonGroup>
  );
}

export function LayoutPresets({ layout, onChange, disabled }) {
  const state = layoutPresetState(layout);
  const pick = (group) => (value) => {
    if (disabled) return;
    const update = layoutUpdateForPreset(group, value);
    if (update) onChange(update);
  };
  const isFlex = (layout?.layoutType || 'flex') === 'flex';
  return (
    <div className="layout-presets">
      <div className="layout-presets-title">Quick presets</div>
      <div className="layout-presets-note">The Visualization toolbar's choices. They set the outlined fields below.</div>
      <div className="layout-presets-row">
        <span className="layout-presets-label">Arrange</span>
        <PresetGroup items={ARRANGE_ITEMS} selected={state.arrange} onPick={pick('arrange')} />
      </div>
      {isFlex && (
        <div className="layout-presets-row">
          <span className="layout-presets-label">Flow</span>
          <PresetGroup items={FLOW_DIRECTION_ITEMS} selected={state.direction} onPick={pick('direction')} icons />
        </div>
      )}
      {isFlex && (
        <div className="layout-presets-row">
          <span className="layout-presets-label">Wrap</span>
          <PresetGroup items={FLOW_WRAP_ITEMS} selected={state.wrap} onPick={pick('wrap')} icons />
        </div>
      )}
      {isFlex && (
        <div className="layout-presets-row">
          <span className="layout-presets-label">Lines</span>
          <PresetGroup items={ALIGN_CONTENT_ITEMS} selected={state.alignContent} onPick={pick('alignContent')} icons />
        </div>
      )}
    </div>
  );
}
