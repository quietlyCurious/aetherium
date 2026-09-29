// customWidgets/TextWidget.jsx
// Text: one piece of text, typically bound — a value, its unit, a label.
// DevExtreme has no plain text widget (its text widgets are editors), and a
// tile is mostly text, so this is Aetherium's own.
//
// A KPI (big value, small grey label) is two of these in a container, not
// a widget of its own: screens are how things combine, and a saved "value +
// label" tile is then a Visual like any other.
//
// Overflow, for text that doesn't fit its box:
//   ellipsis  one line, cut off with …  (the default — a label or a name)
//   wrap      as many lines as it needs
//   shrink    one line, font size reduced until it fits, down to
//             minFontSize — for values in a fixed-size tile, where
//             "12,480 kW" and "7 kW" should both fit the same box.
//
// Colour, size and weight left blank inherit from the container, so the
// slot's typography settings still apply when the widget's own are unset.

import { useLayoutEffect, useRef, useState } from 'react';
import { formatTextValue } from './textFormat';
import './textWidget.css';

const ALIGN_ITEMS = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

// The font size that makes `el`'s content fit its box, given the size it
// was measured at. One proportional step, then a nudge down while it still
// overflows — rendering isn't perfectly linear in font size, but it's
// close, so this settles in one or two measurements rather than a search.
function fittedFontSize(el, measuredAt, minSize) {
  const { clientWidth, clientHeight, scrollWidth, scrollHeight } = el;
  if (!clientWidth || !clientHeight) return measuredAt;
  const scale = Math.min(1, clientWidth / scrollWidth, clientHeight / scrollHeight);
  return Math.max(minSize, Math.floor(measuredAt * scale * 10) / 10);
}

export function TextWidget({
  text, fontSize = 16, fontWeight = 'normal', color = '', textAlign = 'left', verticalAlign = 'center',
  overflow = 'ellipsis', minFontSize = 9, decimals = 'auto', prefix = '', suffix = '',
}) {
  const content = formatTextValue(text, { decimals, prefix, suffix });
  const maxSize = Number(fontSize) > 0 ? Number(fontSize) : 16;
  const minSize = Math.min(maxSize, Number(minFontSize) > 0 ? Number(minFontSize) : 9);
  const shrink = overflow === 'shrink';

  const boxRef = useRef(null);
  const [fitted, setFitted] = useState(maxSize);

  // Shrink: measure at full size, then fit. Re-run when the text, the
  // sizes, or the box itself change (a resize on the canvas, a tile laid
  // out at a different size).
  useLayoutEffect(() => {
    if (!shrink) return undefined;
    const el = boxRef.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.fontSize = `${maxSize}px`;
      let size = fittedFontSize(el, maxSize, minSize);
      el.style.fontSize = `${size}px`;
      // One correction step if rounding left it a hair too wide.
      if (size > minSize && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
        size = Math.max(minSize, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
      setFitted(size);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shrink, content, maxSize, minSize, fontWeight]);

  const style = {
    fontSize: `${shrink ? fitted : maxSize}px`,
    fontWeight,
    color: color || 'inherit',
    textAlign,
    justifyContent: textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start',
    alignItems: ALIGN_ITEMS[verticalAlign] || 'center',
  };

  return (
    <div ref={boxRef} className={`ae-text ae-text--${overflow}`} style={style} title={overflow === 'wrap' ? undefined : content}>
      <span className="ae-text-content">{content}</span>
    </div>
  );
}
