// Style computation helpers — layout, slot, coord, page type

function getLayoutStyle(layout) {
  if (!layout) return {};
  if (layout.layoutType === 'coordinate') {
    return { position: 'relative' };
  }
  if (layout.layoutType === 'grid') {
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${layout.gridColumns || 2}, 1fr)`,
      gridTemplateRows: `repeat(${layout.gridRows || 2}, 1fr)`,
      gap: layout.gridGap || '8px',
    };
  }
  return {
    display: 'flex',
    flexDirection: layout.flexDirection || 'row',
    flexWrap: layout.flexWrap === 'no wrap' ? 'nowrap' : (layout.flexWrap || 'nowrap'),
    justifyContent: layout.justifyContent || 'flex-start',
    alignItems: layout.alignItems || 'stretch',
  };
}

function getCoordStyle(coord) {
  if (!coord) return {};
  const u = coord.unit || 'px';
  const style = { position: 'absolute' };
  if (coord.left !== '' && coord.left !== undefined) style.left = `${coord.left}${u}`;
  if (coord.top !== '' && coord.top !== undefined) style.top = `${coord.top}${u}`;
  if (coord.right !== '' && coord.right !== undefined) style.right = `${coord.right}${u}`;
  if (coord.bottom !== '' && coord.bottom !== undefined) style.bottom = `${coord.bottom}${u}`;
  if (coord.width !== '' && coord.width !== undefined) style.width = `${coord.width}${u}`;
  if (coord.height !== '' && coord.height !== undefined) style.height = `${coord.height}${u}`;
  if (coord.minWidth !== '') style.minWidth = `${coord.minWidth}${u}`;
  if (coord.maxWidth !== '') style.maxWidth = `${coord.maxWidth}${u}`;
  if (coord.minHeight !== '') style.minHeight = `${coord.minHeight}${u}`;
  if (coord.maxHeight !== '') style.maxHeight = `${coord.maxHeight}${u}`;
  return style;
}

function getSlotStyle(slot) {
  if (!slot) return { card: {}, body: {} };
  const card = {
    flexGrow: slot.flexGrow ?? 0,
    flexShrink: slot.flexShrink ?? 1,
    flexBasis: slot.flexBasis || 'auto',
    alignSelf: slot.alignSelf || 'auto',
    order: slot.order || 0,
  };

  // A single consistent floor, matching the resize handles' own 40px minimum —
  // used below so whichever axis is left at 'auto' can never collapse to zero,
  // regardless of which axis ends up being the flex MAIN axis (that can change
  // out from under a container if it's reparented into a different-direction
  // flex container — e.g. column parent to row parent — since 'auto' behaves
  // very differently on the main axis vs. the cross axis).
  const AUTO_AXIS_FLOOR = '40px';

  // ── Width / min-width ────────────────────────────────────────────────────
  // A fixed (non-'auto') width with no explicit min-width can still be squeezed
  // toward zero by the flex-shrink algorithm's "automatic minimum size" rule:
  // min-width defaults to 'auto', which normally floors at the item's content
  // size — UNLESS the item's overflow isn't 'visible' (ours defaults to 'auto'
  // on the body), in which case the browser treats that automatic floor as 0
  // instead. Net effect: a container with a real fixed width could collapse to
  // a sliver under flex-shrink even though width is set correctly. Default
  // min-width to match the fixed width so that can't happen, unless the user
  // set their own min-width. When width itself is 'auto' (unset), fall back to
  // the universal floor instead so THIS axis is protected too if it later
  // becomes the main axis (see AUTO_AXIS_FLOOR above).
  if (slot.width && slot.width !== 'auto') {
    card.width = slot.width;
    card.minWidth = slot.minWidth || slot.width;
  } else {
    if (slot.width) card.width = slot.width; // explicit 'auto'
    card.minWidth = slot.minWidth || AUTO_AXIS_FLOOR;
  }
  if (slot.maxWidth) card.maxWidth = slot.maxWidth;

  // ── Height / min-height ──────────────────────────────────────────────────
  // Same collapse risk as width above, mirrored for the vertical axis.
  if (slot.height && slot.height !== 'auto') {
    card.height = slot.height;
    card.minHeight = slot.minHeight || slot.height;
  } else {
    if (slot.height) card.height = slot.height; // explicit 'auto'
    card.minHeight = slot.minHeight || AUTO_AXIS_FLOOR;
  }
  if (slot.maxHeight) card.maxHeight = slot.maxHeight;

  // Margin and border on the card (outer)
  if (slot.marginTop) card.marginTop = slot.marginTop;
  if (slot.marginBottom) card.marginBottom = slot.marginBottom;
  if (slot.marginLeft) card.marginLeft = slot.marginLeft;
  if (slot.marginRight) card.marginRight = slot.marginRight;
  if (slot.borderWidth) card.borderWidth = slot.borderWidth;
  if (slot.borderStyle) card.borderStyle = slot.borderStyle;
  if (slot.borderColor) card.borderColor = slot.borderColor;
  if (slot.borderRadius) card.borderRadius = slot.borderRadius;
  // Background on the card
  if (slot.backgroundColor) card.backgroundColor = slot.backgroundColor;
  if (slot.backgroundImage) card.backgroundImage = slot.backgroundImage;
  if (slot.backgroundSize) card.backgroundSize = slot.backgroundSize;
  if (slot.backgroundPosition) card.backgroundPosition = slot.backgroundPosition;
  if (slot.backgroundRepeat) card.backgroundRepeat = slot.backgroundRepeat;
  // Typography on the body (applies to content)
  const body = {};
  if (slot.paddingTop) body.paddingTop = slot.paddingTop;
  if (slot.paddingBottom) body.paddingBottom = slot.paddingBottom;
  if (slot.paddingLeft) body.paddingLeft = slot.paddingLeft;
  if (slot.paddingRight) body.paddingRight = slot.paddingRight;
  if (slot.color) body.color = slot.color;
  if (slot.fontSize) body.fontSize = slot.fontSize;
  if (slot.fontWeight) body.fontWeight = slot.fontWeight;
  if (slot.fontFamily) body.fontFamily = slot.fontFamily;
  if (slot.lineHeight) body.lineHeight = slot.lineHeight;
  if (slot.textAlign) body.textAlign = slot.textAlign;
  if (slot.letterSpacing) body.letterSpacing = slot.letterSpacing;
  return { card, body };
}

function getPageTypeStyle(pageType) {
  switch (pageType) {
    case 'fit':
      return { width: '100%', height: '100%', overflow: 'hidden', flexShrink: 0 };
    case 'fixed':
      return { overflow: 'auto' };
    case 'vertical fixed':
      return { width: '100%', overflowX: 'hidden', overflowY: 'auto' };
    case 'horizontal fixed':
      return { height: '100%', overflowY: 'hidden', overflowX: 'auto' };
    default:
      return { width: '100%', height: '100%', overflow: 'hidden' };
  }
}

export { getLayoutStyle, getCoordStyle, getSlotStyle, getPageTypeStyle };
