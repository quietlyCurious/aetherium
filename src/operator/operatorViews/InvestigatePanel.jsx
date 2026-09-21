// operator/operatorViews/InvestigatePanel.jsx
// Operator › Attention, centre panel: why this item needs attention —
// trend, evidence, timeline, confidence/risk/outcome read-outs, and the
// related assets around it, with a time scrubber that drives them from
// real historical readings (it provides TimeScrubContext).

import { useState, useRef, useEffect } from 'react';
import ButtonGroup from 'devextreme-react/button-group';
import { Slider, Label as SliderLabel } from 'devextreme-react/slider';
import { PlayPauseIcon } from '../icons';
import { getAttentionItemAssetEntry, getAttentionItemTypeId, isAttentionItemActiveAtTime, getAttentionItemPrimarySeries, getAttentionItemExplanation } from '../model/assetQueries';
import { CURRENT_TIMESTAMPS, ATTENTION_ITEMS } from '../model/modelData';
import { ReadOnlyRelatedAssetsView } from '../relatedAssets/ReadOnlyViews';
import { TimeScrubContext, AssetCard } from '../relatedAssets/AssetCard';
import { AiInterpretationView } from './AiInterpretationView';
import { ExplanationView } from './explanation/ExplanationView';
import { ComparisonLineChart, EvidenceTable, VerticalTimeline } from './evidenceWidgets';
import { SEVERITY_COLORS } from './statusVocabulary';

const EVIDENCE_VIEW_ITEMS = [
  { text: 'Trend', value: 'line' },
  { text: 'Assets', value: 'relatedAssets' },
  { text: 'AI', value: 'ai' },
];

const RELATED_ASSETS_SUBVIEW_ITEMS = [
  { text: 'This Asset', value: 'thisAsset' },
  { text: 'Related Assets', value: 'related' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Investigate — detail for the selected Attention item
// ─────────────────────────────────────────────────────────────────────────────

export function InvestigatePanel({ item, onCreateWorkItem, onOpenWorkItem, workItems, evidenceView, setEvidenceView, typeList, typeDisplayTemplates, typePropertyConfigs, typeRelatedAssetConfigs, relatedAssetsTemplates, onSaveRelatedAssetsTemplate, assetDisplayTemplates, assetPropertyConfigs, assetRelatedAssetConfigs, assetRelatedAssetsTemplates, activeSaveHandlerRef, onTitleClick, onGearClick }) {
  // This Asset vs. Related Assets sub-toggle, within the Related Assets
  // tab. Declared before the early return below (not alongside the other
  // computed values further down, which only run once item is known) so
  // this hook is always called, on every render, per the Rules of Hooks.
  const [relatedAssetsSubview, setRelatedAssetsSubview] = useState('thisAsset');

  // Time-track scrubber for the Related Assets tab. Defaults to the last
  // index of the shared shift timeline — the exact same instant "current"
  // values already reflect (verified: the static snapshot each box shows
  // by default is identical to the last point of that same property's own
  // series), so nothing visibly changes until the user actually scrubs or
  // presses play. Also declared before the early return per Rules of Hooks.
  const scrubMaxIndex = Math.max(CURRENT_TIMESTAMPS.length, 1) - 1;
  const [scrubTimeIndex, setScrubTimeIndex] = useState(scrubMaxIndex);
  const [scrubPlaying, setScrubPlaying] = useState(false);
  // DevExtreme's Slider fires onValueChanged for a programmatic value prop
  // change exactly the same as a real user drag — it has no way to tell
  // them apart itself. Without this flag, the moment playback's own effect
  // advances the index, the slider would report that as a "value changed"
  // event, and the handler below would immediately call
  // setScrubPlaying(false), self-cancelling playback after a single step.
  // Set to true right before any programmatic setScrubTimeIndex call, and
  // consumed (cleared, without pausing) by the very next onValueChanged.
  const scrubProgrammaticRef = useRef(false);

  useEffect(() => {
    if (!scrubPlaying) return;
    if (scrubTimeIndex >= scrubMaxIndex) {
      setScrubPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      scrubProgrammaticRef.current = true;
      setScrubTimeIndex(i => Math.min(i + 1, scrubMaxIndex));
    }, 400);
    return () => clearTimeout(timer);
  }, [scrubPlaying, scrubTimeIndex, scrubMaxIndex]);

  const handleScrubPlayPause = () => {
    if (!scrubPlaying && scrubTimeIndex >= scrubMaxIndex) {
      scrubProgrammaticRef.current = true;
      setScrubTimeIndex(0);
    }
    setScrubPlaying(p => !p);
  };

  if (!item) {
    return (
      <div className="op-panel op-investigate-panel">
        <div className="op-zone-label">Investigate</div>
        <div className="op-investigate-empty">Select an item in Attention to see the full picture.</div>
      </div>
    );
  }

  const d = item.detail;
  const severityColor = SEVERITY_COLORS[item.severity];
  const explained = getAttentionItemExplanation(item);

  // Related Assets: resolves via attentionAssetToAssetEntry/CURRENT_ASSET_DATA
  // for all three models, including refinery (its own hardcoded ASSET_DATA
  // constant, not a fetched file, but resolved the same way). Stays null
  // only if an attention item's asset string genuinely doesn't match any
  // real asset id, in which case the tab shows a plain "not available"
  // message rather than an empty/broken diagram.
  const relatedAssetsAssetEntry = getAttentionItemAssetEntry(item);
  const relatedAssetsTypeId = relatedAssetsAssetEntry ? `TYPE_${relatedAssetsAssetEntry.assetLevel}_${relatedAssetsAssetEntry.assetType}` : null;
  const relatedAssetsTypeEntry = relatedAssetsTypeId ? typeList.find(t => t.id === relatedAssetsTypeId) : null;

  // Related Alarms: other attention items on the same asset type as this
  // one (e.g. both on an "Aeration" stage, just a different train) —
  // surfaces whether this looks like a one-off or a pattern across the
  // same kind of equipment elsewhere in the plant. There's no dedicated
  // "related alarms" field in the data, so this is derived directly from
  // the attention items list, reusing the same typeId resolution as
  // Related Assets above. A null typeId (an asset string that doesn't
  // resolve) never matches another null, so this stays empty rather than
  // spuriously grouping unrelated unresolved items together.
  const relatedAlarms = relatedAssetsTypeId
    ? ATTENTION_ITEMS.filter(other => other.id !== item.id && getAttentionItemTypeId(other) === relatedAssetsTypeId)
    : [];

  // Shared between the Timeline tab's own content and the small Timeline
  // card shown alongside the Trend chart — same underlying data either way.
  const timelineItems = d.evidencePoints.map(p => ({
    time: p.time,
    primary: p.value,
    secondary: p.label || null,
    highlighted: !!p.label,
    color: severityColor,
  }));

  return (
    <div className="op-panel op-investigate-panel">
      <div className="op-zone-label">Investigate</div>

      <div className="op-investigate-header">
        <span className="op-severity-dot" style={{ background: severityColor }} />
        <div>
          <div className="op-investigate-asset">{item.asset}</div>
          <div className="op-investigate-signal">{item.signal}</div>
        </div>
      </div>

      <div className="op-investigate-toggle-row">
        <ButtonGroup
          items={EVIDENCE_VIEW_ITEMS}
          keyExpr="value"
          selectedItemKeys={[evidenceView]}
          onItemClick={e => setEvidenceView(e.itemData.value)}
          stylingMode="outlined"
          className="op-dash-chart-toggle"
        />
      </div>

      {evidenceView === 'ai' ? (
        // The detector-built explanation when this item has one (spec §14);
        // otherwise the item's own interpretation text, as before.
        explained ? (
          <ExplanationView
            item={item}
            explanation={explained.explanation}
            detector={explained.detector}
            workItems={workItems}
            onCreateWorkItem={onCreateWorkItem}
            onOpenWorkItem={onOpenWorkItem}
          />
        ) : (
          <AiInterpretationView item={item} onCreateWorkItem={onCreateWorkItem} />
        )
      ) : evidenceView === 'relatedAssets' ? (
        <>
          <div className="op-investigate-relatedassets-toprow">
            <ButtonGroup
              items={RELATED_ASSETS_SUBVIEW_ITEMS}
              keyExpr="value"
              selectedItemKeys={[relatedAssetsSubview]}
              onItemClick={e => setRelatedAssetsSubview(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle op-investigate-relatedassets-toggle"
            />
            {CURRENT_TIMESTAMPS[scrubTimeIndex] && (
              <div className="op-investigate-scrubtime">{CURRENT_TIMESTAMPS[scrubTimeIndex]}</div>
            )}
          </div>
          <div className="op-investigate-relatedassets-split">
            <TimeScrubContext.Provider value={scrubTimeIndex}>
              <div className="op-investigate-relatedassets-body">
                {relatedAssetsTypeId ? (
                  relatedAssetsSubview === 'thisAsset' ? (
                    <div className={`op-property-tiles-singlebox op-investigate-related-template${(assetDisplayTemplates?.[relatedAssetsAssetEntry?.id]?.layoutMode ?? typeDisplayTemplates?.[relatedAssetsTypeId]?.layoutMode) === 'manual' ? ' op-property-tiles-singlebox--manual' : ''}`}>
                      <AssetCard
                        relatedTypeId={relatedAssetsTypeId}
                        relatedTypeName={relatedAssetsTypeEntry?.name}
                        relatedTypeExampleAssetId={relatedAssetsAssetEntry?.id}
                        typeDisplayTemplates={typeDisplayTemplates}
                        typePropertyConfigs={typePropertyConfigs}
                        assetDisplayTemplates={assetDisplayTemplates}
                        assetPropertyConfigs={assetPropertyConfigs}
                        evidencePoints={d.evidencePoints}
                        onTitleClick={onTitleClick}
                        onGearClick={onGearClick}
                      />
                    </div>
                  ) : (
                    // Same component the Operator Assets area's own Related
                    // Assets tab uses (OperatorAssetDetail, activeTab==='related')
                    // — guarantees this is literally the same view, not just a
                    // similar one, and correctly threads onGearClick through to
                    // both its Cards and Diagram layout modes (RelatedAssetsEditor,
                    // used here previously, never accepted that prop at all,
                    // which is why the gear icon was missing).
                    <ReadOnlyRelatedAssetsView
                      typeId={relatedAssetsTypeId}
                      assetId={relatedAssetsAssetEntry?.id}
                      typeList={typeList}
                      typeDisplayTemplates={typeDisplayTemplates}
                      typePropertyConfigs={typePropertyConfigs}
                      typeRelatedAssetConfigs={typeRelatedAssetConfigs}
                      assetDisplayTemplates={assetDisplayTemplates}
                      assetPropertyConfigs={assetPropertyConfigs}
                      assetRelatedAssetConfigs={assetRelatedAssetConfigs}
                      evidencePoints={d.evidencePoints}
                      savedTemplate={assetRelatedAssetsTemplates?.[relatedAssetsAssetEntry?.id] ?? relatedAssetsTemplates?.[relatedAssetsTypeId]}
                      onTitleClick={onTitleClick}
                      onGearClick={onGearClick}
                    />
                  )
                ) : (
                  <div className="op-dash-text op-dash-text--muted">Related assets aren't available for this asset.</div>
                )}
              </div>
            </TimeScrubContext.Provider>
            {/* Always visible regardless of which sub-view (This Asset /
                Related Assets) is active on the left — same active-at-
                scrubbed-time highlighting as before, just now a permanent
                fixture rather than a third thing to switch to. */}
            <div className="op-investigate-alarmssidebar">
              <div className="op-dashboard-card-title">Alarms</div>
              {relatedAlarms.length > 0 ? (
                <div className="op-timeline op-timeline--sidebar">
                  {relatedAlarms.map(other => {
                    const active = isAttentionItemActiveAtTime(other, CURRENT_TIMESTAMPS[scrubTimeIndex]);
                    return (
                      <div key={other.id} className={`op-timeline-row${active ? ' op-timeline-row--active' : ''}`}>
                        <span
                          className="op-timeline-dot op-timeline-dot--highlighted"
                          style={{ background: SEVERITY_COLORS[other.severity], boxShadow: `0 0 0 1px ${SEVERITY_COLORS[other.severity]}` }}
                        />
                        <div className="op-timeline-time">{other.since}</div>
                        <div className="op-timeline-primary">
                          {other.asset}
                          {active && <span className="op-investigate-alarm-active-tag">Active now</span>}
                        </div>
                        <div className="op-timeline-secondary">{other.signal}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="op-dash-text op-dash-text--muted">No related alarms on this line right now.</div>
              )}
            </div>
          </div>
          {CURRENT_TIMESTAMPS.length > 0 && (
            <div className="op-investigate-timetrack">
              <button
                type="button"
                className="op-investigate-timetrack-playbtn"
                onClick={handleScrubPlayPause}
                title={scrubPlaying ? 'Pause' : 'Play'}
              >
                <PlayPauseIcon playing={scrubPlaying} />
              </button>
              <Slider
                min={0}
                max={scrubMaxIndex}
                step={1}
                value={scrubTimeIndex}
                onValueChanged={e => {
                  if (scrubProgrammaticRef.current) {
                    scrubProgrammaticRef.current = false;
                    return;
                  }
                  setScrubPlaying(false);
                  setScrubTimeIndex(e.value);
                }}
                className="op-investigate-timetrack-slider"
              >
                <SliderLabel visible format={v => CURRENT_TIMESTAMPS[v] ?? ''} position="bottom" />
              </Slider>
            </div>
          )}
        </>
      ) : (
        <div className="op-investigate-dashboard">
          <div className="op-dashboard-card op-dashboard-card--signal">
            <div className="op-dashboard-card-title">Signal</div>
            <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
              <ComparisonLineChart evidence={d.evidence} evidencePoints={d.evidencePoints} color={severityColor} fullSeries={getAttentionItemPrimarySeries(item)} />
            </div>
          </div>

          <div className="op-dashboard-card op-dashboard-card--timelinemini">
            <div className="op-dashboard-card-title">Timeline</div>
            <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
              <VerticalTimeline maxItems={4} items={timelineItems} />
            </div>
          </div>
          <div className="op-dashboard-card op-dashboard-card--tablemini">
            <div className="op-dashboard-card-title">Table</div>
            <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
              <EvidenceTable evidencePoints={d.evidencePoints} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
