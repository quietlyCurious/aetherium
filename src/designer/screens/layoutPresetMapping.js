// designer/screens/layoutPresetMapping.js
// Quick presets: the Visualization toolbar's layout choices, offered at the
// top of the designer's Layout tab so the two areas speak the same
// language. Each preset is only a shortcut for fields the Layout section
// already has — nothing here is stored on its own:
//
//   Arrange   Flex / Manual        → layoutType  flex / coordinate
//   Flow      Column / Row         → flexDirection
//             Wrap / No Wrap       → flexWrap    ('wrap' / 'no wrap')
//             Distribute / Cluster → alignContent ('stretch' / 'flex-start')
//
// A preset shows as selected only when the fields match it exactly. Set a
// field by hand to something the presets don't have (row-reverse, grid,
// wrap-reverse, center…) and that preset shows nothing selected, rather
// than the presets and the fields quietly disagreeing.
//
// The option lists (labels, icons, order) are the Visualization toolbar's
// own, from operator/settings/layoutOptions.js.

export const ARRANGE_ITEMS = [
  { text: 'Flex', value: 'flex' },
  { text: 'Manual', value: 'manual' },
];

// The Layout fields a preset sets — the ones the Layout section outlines.
export const PRESET_LAYOUT_FIELDS = ['layoutType', 'flexDirection', 'flexWrap', 'alignContent'];

const ARRANGE_TO_TYPE = { flex: 'flex', manual: 'coordinate' };
const WRAP_TO_FIELD = { wrap: 'wrap', nowrap: 'no wrap' };

// An unset align-content behaves as stretch for a flex container, so an
// unset field reads as Distribute.
const effectiveAlignContent = (layout) => layout.alignContent || 'stretch';

// Which preset each group shows as selected, or null when the fields don't
// match any of its choices.
export function layoutPresetState(layout = {}) {
  const type = layout.layoutType || 'flex';
  const arrange = type === 'flex' ? 'flex' : type === 'coordinate' ? 'manual' : null;
  const direction = ['row', 'column'].includes(layout.flexDirection || 'row') ? (layout.flexDirection || 'row') : null;
  const wrapField = layout.flexWrap || 'no wrap';
  const wrap = wrapField === 'wrap' ? 'wrap' : (wrapField === 'no wrap' || wrapField === 'nowrap') ? 'nowrap' : null;
  const align = effectiveAlignContent(layout);
  const alignContent = ['stretch', 'flex-start'].includes(align) ? align : null;
  return { arrange, direction, wrap, alignContent };
}

// The Layout update a preset click makes.
export function layoutUpdateForPreset(group, value) {
  switch (group) {
    case 'arrange': return ARRANGE_TO_TYPE[value] ? { layoutType: ARRANGE_TO_TYPE[value] } : null;
    case 'direction': return ['row', 'column'].includes(value) ? { flexDirection: value } : null;
    case 'wrap': return WRAP_TO_FIELD[value] ? { flexWrap: WRAP_TO_FIELD[value] } : null;
    case 'alignContent': return ['stretch', 'flex-start'].includes(value) ? { alignContent: value } : null;
    default: return null;
  }
}
