// operator/properties/PropertyTile.jsx
// PropertyTile: one property's value as a tile, in any of the view modes
// (Text / Indicator / Spark / All, or a custom tile — a saved screen about a
// property, drawn by PropertyScreenTile). Every property rendering in the
// app ends up here: the properties listing, the related-asset boxes, the
// manual-layout canvases, Line Detail.

import { MiniSparkline, ResponsiveSparkline } from './sparklines';
import { PropertyScreenTile, canDrawPropertyScreen } from './PropertyScreenTile';
import { screenIdOfViewMode } from '../settings/propertyDisplay';

// Value-first, label-second — the opposite emphasis of a bullet graph.
// Built for exactly the case a bullet handles badly: station-level KPIs
// that cluster tightly (95-100%) and read as identical-looking full bars
// rather than showing any real variation. The number itself carries the
// information here; the label just says what it is.
// unit/decimals come from the pack's properties.json (spec §3.4); a key
// with neither renders its value as-is.
// assetId/propertyKey say which property of which asset this is — only a
// custom tile needs them, since its screen reads the property itself. A
// custom tile that can't be drawn (its screen was deleted, or no asset was
// given) falls back to All.
export function PropertyTile({ label, value, min, max, sparkline, labelFirst, horizontal, viewMode: requestedViewMode = 'all', unit, decimals, assetId, propertyKey }) {
  const screenId = screenIdOfViewMode(requestedViewMode);
  if (screenId && canDrawPropertyScreen(screenId, assetId, propertyKey)) {
    return <PropertyScreenTile pageId={screenId} assetId={assetId} propertyKey={propertyKey} value={value} label={label} />;
  }
  const viewMode = screenId ? 'all' : requestedViewMode;
  const hasRange = min != null && max != null && typeof value === 'number' && max > min;
  const pct = hasRange ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : null;

  // Observed range: the real min/max the sparkline has actually shown —
  // not a fabricated threshold, just "here's where this has actually
  // moved" shaded onto the same scale as the current-value marker.
  let observed = null;
  if (hasRange && sparkline && sparkline.length > 1) {
    const obsMin = Math.min(...sparkline);
    const obsMax = Math.max(...sparkline);
    const left = Math.max(0, Math.min(100, ((obsMin - min) / (max - min)) * 100));
    const right = Math.max(0, Math.min(100, ((obsMax - min) / (max - min)) * 100));
    if (right > left) observed = { left, width: right - left };
  }

  const labelEl = <div className="op-property-tile-label">{label}</div>;
  const displayValue = (typeof value === 'number' && decimals != null) ? value.toFixed(decimals) : value;
  const valueEl = (
    <div className="op-property-tile-value">
      {displayValue}
      {unit && <span className="op-property-tile-unit">{unit}</span>}
    </div>
  );

  const vtrackEl = hasRange && (
    <div className="op-property-tile-vtrack">
      {observed && (
        <div className="op-property-tile-vtrack-observed" style={{ bottom: `${observed.left}%`, height: `${observed.width}%` }} />
      )}
      <div className="op-property-tile-vtrack-marker" style={{ bottom: `${pct}%` }} />
    </div>
  );

  if (horizontal) {
    // Text — value over label only, no indicator, no sparkline. The
    // plainest possible reading of the number.
    if (viewMode === 'text') {
      return (
        <div className="op-property-tile op-property-tile--text">
          {valueEl}
          {labelEl}
        </div>
      );
    }

    // Indicator — label on top, the same vertical track used elsewhere,
    // value underneath. A vertical card rather than a row.
    if (viewMode === 'indicator') {
      return (
        <div className="op-property-tile op-property-tile--indicator">
          {vtrackEl}
          {valueEl}
          {labelEl}
        </div>
      );
    }

    // Spark — identical to the default row, just without the track.
    // "All" (the default) and "Spark" share this same row layout, differing
    // only in whether the indicator renders.
    const showTrack = viewMode !== 'spark';
    return (
      <div className="op-property-tile op-property-tile--row">
        {showTrack && vtrackEl}
        <div className="op-property-tile-info">
          {labelFirst ? labelEl : valueEl}
          {labelFirst && valueEl}
          {!labelFirst && labelEl}
        </div>
        {sparkline && (
          <div className="op-property-tile-spark">
            <ResponsiveSparkline values={sparkline} height={60} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="op-property-tile">
      {labelFirst ? labelEl : valueEl}
      {labelFirst && valueEl}
      {hasRange && (
        <>
          <div className="op-property-tile-track">
            {observed && (
              <div className="op-property-tile-track-observed" style={{ left: `${observed.left}%`, width: `${observed.width}%` }} />
            )}
            <div className="op-property-tile-track-marker" style={{ left: `${pct}%` }} />
          </div>
          <div className="op-property-tile-track-labels">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </>
      )}
      {sparkline && (
        <div className="op-property-tile-spark">
          <MiniSparkline values={sparkline} width={160} />
        </div>
      )}
      {!labelFirst && labelEl}
    </div>
  );
}
