// operator/operatorViews/explanation/ExplanationView.jsx
// Investigate's AI tab when the selected attention item has a
// detector-built explanation (explanations.json, INDUSTRY_PACK_SPEC.md
// §14). It shows *why* the system thinks what it thinks, so an operator
// can check the reasoning rather than just trust it:
//   1 What we see       — the asset against what it should be doing
//   2 Why we think so   — the failure's signature, checked against the data
//   3 What this looks like — reference examples with this case overlaid
//   4 What we ruled out — other causes of the same symptom, and why not
//   5 How sure are we   — confidence, and what would change it
//   6 What to do        — the recommendation and its linked tasks
// plus past occurrences and, folded away, how the detector works.
// Every section is optional except the conclusion and the checks, so a
// compliance item (nothing to rule out) renders without gaps.

import { CURRENT_TIMESTAMPS } from '../../../model/modelData';
import { InvestigateStatCards } from '../InvestigateStatCards';
import { ChartLegend, ExplanationChart, ExplanationSpark } from './ExplanationChart';

const CHECK_ICONS = { match: '✓', nomatch: '–', pending: '?' };
const VERDICT_ICONS = { match: '✓', partial: '≈', nomatch: '✗' };

const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

function formatClock(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return d.toTimeString().slice(0, 5);
}

function Section({ step, title, subtitle, children, className = '' }) {
  return (
    <section className={`op-explanation-card ${className}`}>
      <h3 className="op-explanation-card-title">
        {step != null && <span className="op-explanation-step">{step}</span>}
        {title}
      </h3>
      {subtitle && <p className="op-explanation-card-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

function CheckRow({ check, timestamps }) {
  return (
    <div className="op-explanation-check">
      <div className={`op-explanation-check-icon op-explanation-check-icon--${check.status}`} title={check.status}>
        {CHECK_ICONS[check.status]}
      </div>
      <div className="op-explanation-check-text">
        <div className="op-explanation-check-label">
          {check.label}
          <span className="op-explanation-kind">{check.role}{check.status === 'pending' ? ' · not yet checked' : ''}</span>
        </div>
        <div className="op-explanation-check-value">{check.value}</div>
        <div className="op-explanation-check-why">{check.why}</div>
      </div>
      <div className="op-explanation-check-spark">
        {check.spark && <ExplanationSpark spark={check.spark} timestamps={timestamps} />}
      </div>
    </div>
  );
}

function ReferenceCard({ reference, timestamps }) {
  return (
    <div className={`op-explanation-ref${reference.verdict.kind === 'match' ? ' op-explanation-ref--best' : ''}`}>
      <div className="op-explanation-ref-head">
        <b>{reference.title}</b>
        <span className="op-explanation-ref-tag">{reference.tag}</span>
      </div>
      <div className="op-explanation-ref-desc">{reference.description}</div>
      {reference.charts.map((c, k) => (
        <div key={k}>
          <div className="op-explanation-ref-charttitle">{c.title}</div>
          <ExplanationChart spec={c} timestamps={timestamps} height={k === 0 ? 110 : 80} compact />
        </div>
      ))}
      <div className="op-explanation-ref-verdict">
        <span className={`op-explanation-ref-verdict-text op-explanation-ref-verdict-text--${reference.verdict.kind}`}>
          {VERDICT_ICONS[reference.verdict.kind]} {reference.verdict.text}
        </span>
        <ul>{reference.notes.map(n => <li key={n}>{n}</li>)}</ul>
      </div>
    </div>
  );
}

function LinkedWorkItem({ work, onOpenWorkItem }) {
  const status = work.done
    ? `done ${formatClock(work.completedAt) ?? ''}`.trim()
    : work.dueAt ? `due ${formatClock(work.dueAt)} · not done` : 'not done';
  return (
    <button type="button" className="op-explanation-work" onClick={() => onOpenWorkItem?.(work.id)} disabled={!onOpenWorkItem}>
      <b>{work.text}{work.source === 'ai' && <span className="op-ai-pill">AI</span>}</b>
      <span>{work.assignedRole} · {status}</span>
    </button>
  );
}

export function ExplanationView({ item, explanation, detector, workItems, onCreateWorkItem, onOpenWorkItem }) {
  const x = explanation;
  const d = item.detail;
  const ts = CURRENT_TIMESTAMPS;
  const required = x.checks.filter(c => c.role === 'required');
  const matched = x.checks.filter(c => c.status === 'match').length;
  const linkedWork = (x.action?.workItemIds || []).map(id => workItems?.find(w => w.id === id)).filter(Boolean);
  const hasRuledOut = x.ruledOut?.length > 0;
  let step = 0;
  const next = () => ++step;

  return (
    <div className="op-explanation">
      <InvestigateStatCards
        confidenceLevel={x.confidence.level}
        confidenceText={x.conclusion.confidenceText}
        riskLevel={d.riskLevel}
        riskText={d.risk}
        outcomeStatus={d.outcomeStatus}
        outcomeText={d.expectedOutcome !== '—' ? d.expectedOutcome : 'No outcome defined'}
      />

      <div className="op-explanation-scroll">
        <section className="op-explanation-card op-explanation-conclusion">
          <div className="op-explanation-conclusion-label">{x.conclusion.label}</div>
          <div className="op-explanation-conclusion-text">{x.conclusion.text}</div>
          <div className="op-explanation-chips">
            {detector && <span className="op-explanation-chip op-explanation-chip--detector">Detector: {detector.name} · v{detector.version}</span>}
            <span className="op-explanation-chip">Raised {x.detectedAt}</span>
            {detector && <span className="op-explanation-chip">Archetype {detector.archetype}</span>}
          </div>
        </section>

        <Section step={next()} title={x.chart.title || 'What we see'} subtitle={x.chart.caption}>
          <ChartLegend spec={x.chart} />
          <ExplanationChart spec={x.chart} timestamps={ts} height={240} />
        </Section>

        <Section step={next()} title="Why we think so" subtitle="The signature of this failure, checked against the data.">
          <div className="op-explanation-tally">
            <span>{matched} of {x.checks.length} checks match</span>
            <span>{required.length} required · {x.checks.length - required.length} supporting</span>
          </div>
          {x.checks.map(c => <CheckRow key={c.id} check={c} timestamps={ts} />)}
        </Section>

        {x.references?.length > 0 && (
          <Section step={next()} title="What this looks like" subtitle="Reference examples, with this case drawn over each from its onset.">
            <div className="op-explanation-legend">
              <span><i className="op-explanation-swatch" style={{ borderColor: '#4b5563' }} />Reference example</span>
              <span><i className="op-explanation-swatch" style={{ borderColor: '#0078d4' }} />This case</span>
            </div>
            <div className="op-explanation-refs">
              {x.references.map(r => <ReferenceCard key={r.id} reference={r} timestamps={ts} />)}
            </div>
          </Section>
        )}

        <div className="op-explanation-columns">
          {hasRuledOut && (
            <Section step={next()} title="What we ruled out" subtitle="Other causes of the same symptom, and why they don't fit.">
              {x.ruledOut.map(r => (
                <div key={r.cause} className="op-explanation-ruledout">
                  <div className="op-explanation-ruledout-cause">
                    {r.cause}<span className="op-explanation-ruledout-verdict">{r.verdict}</span>
                  </div>
                  <div className="op-explanation-ruledout-reason">{r.reason}</div>
                  {r.chart && (
                    <>
                      <ChartLegend spec={r.chart} />
                      <ExplanationChart spec={r.chart} timestamps={ts} height={140} compact />
                    </>
                  )}
                </div>
              ))}
              {x.excluded && <div className="op-explanation-note">{x.excluded}</div>}
            </Section>
          )}

          <div className="op-explanation-stack">
            <Section step={next()} title="How sure are we">
              <div className="op-explanation-confidence-level">
                {x.confidence.level === 'n/a' ? 'Not applicable' : capitalize(x.confidence.level)}
              </div>
              <dl className="op-explanation-kv">
                <dt>Because</dt><dd>{x.confidence.because}</dd>
                {x.confidence.confirmedBy && <><dt className="op-explanation-up">Confirmed by</dt><dd>{x.confidence.confirmedBy}</dd></>}
                {x.confidence.notHigherBecause && <><dt>Not higher because</dt><dd>{x.confidence.notHigherBecause}</dd></>}
                {x.confidence.raiseIf && <><dt className="op-explanation-up">Raise if</dt><dd>{x.confidence.raiseIf}</dd></>}
                {x.confidence.lowerIf && <><dt className="op-explanation-down">Lower if</dt><dd>{x.confidence.lowerIf}</dd></>}
              </dl>
            </Section>

            <Section step={next()} title="What to do">
              <div className="op-explanation-action">{x.action?.text || d.recommendation}</div>
              {x.impact && <div className="op-explanation-note">{x.impact}</div>}
              {linkedWork.map(w => <LinkedWorkItem key={w.id} work={w} onOpenWorkItem={onOpenWorkItem} />)}
              <button className="op-btn op-btn--primary op-explanation-create" onClick={() => onCreateWorkItem(item)}>
                Create work item
              </button>
            </Section>

            {d.relatedOccurrences?.length > 0 && (
              <Section title="Seen here before">
                {d.relatedOccurrences.map(o => (
                  <div key={o.date + o.summary} className="op-explanation-ruledout">
                    <div className="op-explanation-ruledout-cause">{o.date}</div>
                    <div className="op-explanation-ruledout-reason">{o.summary}</div>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </div>

        {detector && (
          <details className="op-explanation-card op-explanation-engineer">
            <summary>How this detector works <span>for engineers: {detector.summary}</span></summary>
            <div className="op-explanation-pipeline">
              {detector.pipeline.map((b, i) => (
                <div key={b.title} className="op-explanation-pipeline-step">
                  {i > 0 && <span className="op-explanation-pipeline-arrow">→</span>}
                  <div className="op-explanation-pipeline-block"><b>{b.title}</b>{b.text}</div>
                </div>
              ))}
            </div>
            {detector.run && (
              <div className="op-explanation-run">
                Ran on {detector.run.evaluated} {detector.appliesTo} on {detector.run.date}; raised on {detector.run.fired.length}:{' '}
                {detector.run.fired.map(f => `${f.label} at ${f.at}`).join(', ')}.
                {x.model && <> Expected value: <code>{x.model.formula}</code>, fitted on {x.model.fittedOn}.</>}
              </div>
            )}
            <pre className="op-explanation-definition">{JSON.stringify(detector.definition, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
