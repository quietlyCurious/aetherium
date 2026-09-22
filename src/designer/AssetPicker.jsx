// designer/AssetPicker.jsx
// Picks one asset of the loaded model, searchable by name or full path
// ("Boreas Ridge › Feeder 4 › WTG-22" — the path tells apart siblings that
// share a name, like every turbine's Drivetrain). `assetIds` narrows the
// choice, e.g. to the assets of one type. onChange(id, { byUser }):
// byUser is false when the box changed by itself (its value was no longer
// among the choices), so callers can tell a real pick from a fallback.

import { useMemo } from 'react';
import { SelectBox } from 'devextreme-react/select-box';
import { assetOptions } from './modelOptions';

export function AssetPicker({ value, onChange, assetIds = null, placeholder = 'Choose an asset…', clearable = true, width = '100%' }) {
  const all = assetOptions();
  const dataSource = useMemo(() => {
    if (!assetIds) return all;
    const wanted = new Set(assetIds);
    return all.filter(a => wanted.has(a.id));
  }, [all, assetIds]);
  return (
    <SelectBox
      stylingMode="outlined"
      height={26}
      width={width}
      dataSource={dataSource}
      valueExpr="id"
      displayExpr="path"
      value={value || null}
      placeholder={placeholder}
      searchEnabled
      searchExpr={['name', 'path']}
      searchMode="contains"
      showClearButton={clearable}
      onValueChanged={e => onChange(e.value, { byUser: !!e.event })}
    />
  );
}
