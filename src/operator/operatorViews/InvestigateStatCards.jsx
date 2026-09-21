// operator/operatorViews/InvestigateStatCards.jsx
// Confidence / Risk / Outcome as three icon+badge stat cards — the row at
// the top of Investigate's AI tab. Shared by both versions of that tab:
// the detector-built ExplanationView and the plain AiInterpretationView
// fallback, so they read the same at a glance.

import { ConfidenceIcon, ShieldCheckIcon, RiskAlertIcon, TrendUpIcon, DashIcon } from '../icons';

const CONFIDENCE_COLORS = { high: '#0078d4', medium: '#5b9bd5', low: '#9db3c9', 'n/a': '#c2c6cc' };

const CONFIDENCE_LABELS = { high: 'High', medium: 'Medium', low: 'Low', 'n/a': 'N/A' };

export const CONFIDENCE_BARS = { high: 3, medium: 2, low: 1, 'n/a': 0 };

const RISK_COLORS = { high: '#d64545', medium: '#e0a336', low: '#3fa64c', none: '#9096a3' };

const RISK_LABELS = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

const OUTCOME_COLORS = { recovering: '#3fa64c', resolved: '#3fa64c', none: '#9096a3' };

const OUTCOME_LABELS = { recovering: 'Improving', resolved: 'Resolved', none: 'N/A' };

export function InvestigateStatCards({ confidenceLevel, confidenceText, riskLevel, riskText, outcomeStatus, outcomeText }) {
  return (
    <div className="op-dashboard-card op-dashboard-card--ministats">
      <div className="op-dash-ministat-row">
        <div className="op-dash-ministat" style={{ color: CONFIDENCE_COLORS[confidenceLevel] }}>
          <div className="op-dash-ministat-top">
            <span className="op-dash-ministat-icon"><ConfidenceIcon filled={CONFIDENCE_BARS[confidenceLevel]} /></span>
            <div className="op-dash-ministat-textblock">
              <span className="op-dash-ministat-category">Confidence</span>
              <span className="op-dash-ministat-value">{CONFIDENCE_LABELS[confidenceLevel]}</span>
            </div>
          </div>
          <div className="op-dash-ministat-detail">{confidenceText}</div>
        </div>
        <div className="op-dash-ministat" style={{ color: RISK_COLORS[riskLevel] }}>
          <div className="op-dash-ministat-top">
            <span className="op-dash-ministat-icon">{riskLevel === 'none' ? <ShieldCheckIcon /> : <RiskAlertIcon />}</span>
            <div className="op-dash-ministat-textblock">
              <span className="op-dash-ministat-category">Risk</span>
              <span className="op-dash-ministat-value">{RISK_LABELS[riskLevel]}</span>
            </div>
          </div>
          <div className="op-dash-ministat-detail">{riskText}</div>
        </div>
        <div className="op-dash-ministat" style={{ color: OUTCOME_COLORS[outcomeStatus] }}>
          <div className="op-dash-ministat-top">
            <span className="op-dash-ministat-icon">
              {outcomeStatus === 'recovering' ? <TrendUpIcon /> : outcomeStatus === 'resolved' ? <ShieldCheckIcon /> : <DashIcon />}
            </span>
            <div className="op-dash-ministat-textblock">
              <span className="op-dash-ministat-category">Outcome</span>
              <span className="op-dash-ministat-value">{OUTCOME_LABELS[outcomeStatus]}</span>
            </div>
          </div>
          <div className="op-dash-ministat-detail">{outcomeText}</div>
        </div>
      </div>
    </div>
  );
}
