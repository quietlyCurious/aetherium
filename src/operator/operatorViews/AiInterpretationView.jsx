// operator/operatorViews/AiInterpretationView.jsx
// Investigate's AI tab for an attention item that has no detector-built
// explanation (packs without detectors yet): the stat cards plus the item's own observed / derived / inferred
// text and next steps. Items that do have an explanation get
// ExplanationView instead — see InvestigatePanel.

import { AiPill } from '../badges';
import { InvestigateStatCards } from './InvestigateStatCards';

export function AiInterpretationView({ item, onCreateWorkItem }) {
  const d = item.detail;
  return (
    <>
      <InvestigateStatCards
        confidenceLevel={d.confidenceLevel}
        confidenceText={d.confidence}
        riskLevel={d.riskLevel}
        riskText={d.risk}
        outcomeStatus={d.outcomeStatus}
        outcomeText={d.expectedOutcome !== '—' ? d.expectedOutcome : 'No outcome defined'}
      />
      <div className="op-investigate-dashboard op-investigate-dashboard--ai">
        <div className="op-dashboard-card op-dashboard-card--interpretation">
          <div className="op-dashboard-card-title">Interpretation</div>
          <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
            <div className="op-dash-text op-dash-text--clamp3">{d.signal}</div>
            <div className="op-dash-separator" />
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--observed">Observed</span>
              <div className="op-dash-text op-dash-text--clamp2">{d.observed}</div>
            </div>
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--derived">Derived</span>
              <div className="op-dash-text op-dash-text--clamp2">{d.derived}</div>
            </div>
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--inferred"><AiPill />Inferred</span>
              <div className="op-dash-text op-dash-text--clamp2">{d.inferred}</div>
            </div>
            <div className="op-dash-separator" />
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--inferred"><AiPill />Next steps</span>
              <div className="op-dash-text op-dash-text--clamp3">{d.recommendation}</div>
            </div>
            <button className="op-btn op-btn--primary op-investigate-createworkitem-btn" onClick={() => onCreateWorkItem(item)}>
              Create work item
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
