// operator/properties/sparklines.jsx
// The two sparkline components: MiniSparkline (fixed size, a thin wrapper
// over DevExtreme's Sparkline) and ResponsiveSparkline (the same, sized
// to its container's measured width). Only ever fed real sampled series.

import { useRef, useState, useEffect } from 'react';
import Sparkline from 'devextreme-react/sparkline';

export function MiniSparkline({ values, type = 'line', color, width = 100, height = 26 }) {
  const data = values.map((v, i) => ({ x: i, y: v }));
  const lineColor = color || '#9096a3';
  const firstLastColor = color || '#9096a3';
  return (
    <Sparkline
      dataSource={data}
      argumentField="x"
      valueField="y"
      type={type}
      lineColor={lineColor}
      {...(color ? { pointColor: color } : {})}
      firstLastColor={firstLastColor}
      winColor="#3fa66c"
      lossColor="#d64545"
      showMinMax={true}
      maxColor="#e0a336"
      minColor="#e0a336"
      width={width}
      height={height}
    />
  );
}

// Genuinely responsive width: measures its own container via
// ResizeObserver and passes the real pixel width down to MiniSparkline
// explicitly, every time it changes. Height stays fixed (that's not what
// was asked to move) — only width is ever measured and re-passed.
export function ResponsiveSparkline({ values, height = 26, color }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(100);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="op-statkpi-spark-inner">
      <MiniSparkline values={values} width={Math.max(1, Math.round(width))} height={height} color={color} />
    </div>
  );
}
