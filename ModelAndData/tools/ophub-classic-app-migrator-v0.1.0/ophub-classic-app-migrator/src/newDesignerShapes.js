// Builders for the structural objects of a new-designer page:
//   Root container -> Grid container -> Card (flex_container) -> Widget (embedded_html)
// Templates come from real exports (reference.json); these functions only fill them in.

import { deepClone, newId } from './util.js';

const ZERO_BOX = {
  display: 'block', marginTop: '0', marginLeft: '0', marginRight: '0', marginBottom: '0',
  paddingTop: '0', paddingLeft: '0', paddingRight: '0', paddingBottom: '0',
};

export function defaultResponsiveStyle(isVisible = true) {
  const one = () => ({ css: { ...ZERO_BOX }, isVisible });
  return { desktop: one(), tablet: one(), mobile: one() };
}

/** Page root: one coordinated_container holding one gridster grid of cards. */
export function buildPageRoot(reference, cards, gridSize) {
  const root = deepClone(reference.rootContainer);
  root.id = newId();
  const grid = deepClone(reference.gridContainer);
  grid.components = cards;
  const opts = grid.gridsterOptions.options;
  opts.gridType = 'fixed';
  opts.minCols = Math.max(opts.minCols, gridSize.cols);
  opts.maxCols = Math.max(opts.maxCols, gridSize.cols);
  opts.minRows = Math.max(opts.minRows, gridSize.rows);
  opts.maxRows = Math.max(opts.maxRows, gridSize.rows);
  root.components = [grid];
  return root;
}

/**
 * A flexbox card. Multi-widget cards wrap so migrated widgets flow left-to-right in their
 * original order instead of overlapping.
 */
export function buildCard(reference, { id, x, y, cols, rows, widgets, conditions, isHidden, wrap }) {
  const card = deepClone(reference.flexCard);
  card.id = id || newId();
  Object.assign(card, { x, y, cols, rows, components: widgets });
  const flexWrap = wrap ? 'wrap' : 'nowrap';
  card.flexWrap = flexWrap;
  card.alignItems = wrap ? 'flex-start' : 'stretch';
  card.alignContent = wrap ? 'flex-start' : 'stretch';
  card.rowGap = wrap ? 8 : 0;
  card.columnGap = wrap ? 8 : 0;
  card.style.css = {
    ...card.style.css,
    width: '100%', height: '100%', top: '0%', left: '0%',
    'flex-wrap': flexWrap,
    'align-items': card.alignItems,
    'align-content': card.alignContent,
    'row-gap': `${card.rowGap}px`,
    'column-gap': `${card.columnGap}px`,
  };
  if (card.preserveAspectRatio) card.preserveAspectRatio.preserveAspectRatio = false;
  if (conditions?.conditionsList?.length) card.conditions = conditions;
  if (isHidden) card.isHidden = true;
  return card;
}

/**
 * Size block shared by externalProperties and schema.data.widget.
 * `fill` = sole widget in its card -> stretch to the card; otherwise a fixed px box.
 */
function sizeBlock({ width, height, fill, isHidden }) {
  return {
    width: fill ? 100 : width,
    height: fill ? 100 : height,
    zIndex: 1,
    rotation: 0,
    unit: fill ? '%' : 'px',
    lockAspect: 'false',
    lockAspectRatio: fill ? 1 : width / height,
    isHidden: !!isHidden,
    alignSelf: 'auto',
    offsetTop: 0, offsetLeft: 0, offsetRight: 0, offsetBottom: 0,
    xRelative: 'offsetLeft', yRelative: 'offsetTop',
    flexGrow: fill ? 1 : 0, flexShrink: 1, flexBasis: 'auto',
    style: { roundedCorners: false, customColors: false },
  };
}

/**
 * Full embedded_html widget envelope around plugin-specific schema data.
 * @param spec { id, typeName, pluginInfo, data, size:{width,height}, fill, isHidden, conditions, multiActions, scopedCss }
 */
export function buildWidget(spec) {
  const { id, typeName, pluginInfo, data, size, fill, isHidden, conditions, multiActions, scopedCss = true } = spec;
  const sizing = sizeBlock({ ...size, fill, isHidden });
  const responsiveStyle = defaultResponsiveStyle(true);
  const widget = {
    id,
    type: 'embedded_html',
    typeName,
    origin: pluginInfo.origin || 'custom',
    template: 'component.embedded_html',
    classList: [],
    compDblClicked: false,
    useScopedCss: scopedCss,
    isHidden: !!isHidden,
    pluginInfo,
    schema: {
      data: {
        ...data,
        changeProperty: false,
        isHidden: !!isHidden,
        pluginId: [id],
        scopedCSS: scopedCss,
        responsiveStyle: deepClone(responsiveStyle),
        widget: deepClone(sizing),
      },
    },
    externalProperties: sizing,
    internalProperties: { x: 0, y: 0, hFlip: false, vFlip: false, size: { width: 5, height: 5, rotation: 0, unit: 'px' } },
    responsiveStyle,
    style: {
      css: fill
        ? { width: '100%', height: '100%', flex: '1 1 auto', 'align-self': 'auto', overflow: 'auto' }
        : { width: `${size.width}px`, height: `${size.height}px`, flex: '0 1 auto', 'align-self': 'auto', overflow: 'auto' },
    },
  };
  if (conditions?.conditionsList?.length) widget.conditions = conditions;
  if (multiActions) widget.multiActions = multiActions;
  return widget;
}
