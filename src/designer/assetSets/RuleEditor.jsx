// designer/assetSets/RuleEditor.jsx
// The form for a rule set, top to bottom in the order the rule is applied
// (model/assetSets.js resolveRule): where to look, which types, attention,
// property conditions, then optionally keep only the lowest/highest N.
//
// `rule` is the draft's rule; `onChange(changes)` merges into it. `start`
// is the preview's start asset, used only to offer the properties that
// assets under it actually have.

import { SelectBox } from 'devextreme-react/select-box';
import { TagBox } from 'devextreme-react/tag-box';
import { NumberBox } from 'devextreme-react/number-box';
import {
  ATTENTION_FILTERS, CONDITION_OPS, DEPTHS, RANK_MODES, START_MODES,
  propertiesOf, ruleCandidates,
} from '../../model/assetSets';
import { typeOptions } from '../modelOptions';
import { AssetPicker } from '../AssetPicker';

const box = { stylingMode: 'outlined', height: 26, width: '100%' };

function Row({ label, children, hint }) {
  return (
    <>
      <span className="details-grid-label">{label}</span>
      <div className="details-grid-control asset-set-control">
        {children}
        {hint && <div className="asset-set-hint">{hint}</div>}
      </div>
    </>
  );
}

function Section({ step, title, children }) {
  return (
    <div className="asset-set-section">
      <div className="asset-set-section-title"><span className="asset-set-step">{step}</span>{title}</div>
      <div className="asset-set-form">{children}</div>
    </div>
  );
}

function ConditionsEditor({ conditions, properties, onChange }) {
  const update = (i, changes) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...changes } : c)));
  const remove = (i) => onChange(conditions.filter((_, j) => j !== i));
  const add = () => onChange([...conditions, { key: null, op: '<', value: null }]);
  return (
    <div className="asset-set-conditions">
      {conditions.length === 0 && <div className="asset-set-hint">No conditions: every asset above counts.</div>}
      {conditions.map((c, i) => (
        <div key={i} className="asset-set-condition">
          <SelectBox
            {...box}
            dataSource={properties}
            valueExpr="key"
            displayExpr="label"
            value={c.key}
            placeholder="Property…"
            searchEnabled
            onValueChanged={e => update(i, { key: e.value })}
          />
          <SelectBox {...box} width={58} dataSource={CONDITION_OPS} valueExpr="value" displayExpr="label" value={c.op} onValueChanged={e => update(i, { op: e.value })} />
          <NumberBox {...box} width={84} value={c.value} placeholder="value" onValueChanged={e => update(i, { value: e.value })} />
          <button className="focus-mode-btn asset-set-remove" title="Remove condition" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button className="focus-mode-btn asset-set-add" onClick={add}>+ Add condition</button>
    </div>
  );
}

export function RuleEditor({ rule, onChange, start }) {
  const properties = propertiesOf(ruleCandidates(rule, start));
  const rank = rule.rank || {};
  const ranking = rank.mode === 'lowest' || rank.mode === 'highest';

  return (
    <>
      <Section step="1" title="Where to look">
        <Row label="Look in">
          <SelectBox {...box} dataSource={START_MODES} valueExpr="value" displayExpr="label" value={rule.start.mode}
            onValueChanged={e => onChange({ start: { ...rule.start, mode: e.value } })} />
        </Row>
        {rule.start.mode === 'asset' && (
          <Row label="Asset">
            <AssetPicker value={rule.start.assetId} onChange={id => onChange({ start: { ...rule.start, assetId: id } })} />
          </Row>
        )}
        {rule.start.mode !== 'model' && (
          <Row label="How far down">
            <SelectBox {...box} dataSource={DEPTHS} valueExpr="value" displayExpr="label" value={rule.depth}
              onValueChanged={e => onChange({ depth: e.value })} />
          </Row>
        )}
        {rule.start.mode === 'parameter' && (
          <div className="asset-set-callout">
            Whoever uses this set says which asset to start from. A feeder screen, for example, would pass its own feeder. Pick one under <b>Preview with start</b> to try it.
          </div>
        )}
      </Section>

      <Section step="2" title="Keep">
        <Row label="Types" hint={rule.typeIds.length ? null : 'Any type'}>
          <TagBox
            stylingMode="outlined"
            width="100%"
            dataSource={typeOptions()}
            valueExpr="id"
            displayExpr="name"
            value={rule.typeIds}
            placeholder="Any type"
            searchEnabled
            showSelectionControls
            applyValueMode="instantly"
            itemRender={t => <span>{t.name} <span className="asset-set-muted">· {t.level}</span></span>}
            onValueChanged={e => onChange({ typeIds: e.value || [] })}
          />
        </Row>
        <Row label="Attention">
          <SelectBox {...box} dataSource={ATTENTION_FILTERS} valueExpr="value" displayExpr="label" value={rule.attention}
            onValueChanged={e => onChange({ attention: e.value })} />
        </Row>
      </Section>

      <Section step="3" title="Conditions (all must be true)">
        <div className="asset-set-wide">
          <ConditionsEditor conditions={rule.conditions} properties={properties} onChange={conditions => onChange({ conditions })} />
        </div>
      </Section>

      <Section step="4" title="Best / worst">
        <Row label="Keep">
          <SelectBox {...box} dataSource={RANK_MODES} valueExpr="value" displayExpr="label" value={rank.mode || 'all'}
            onValueChanged={e => onChange({ rank: { ...rank, mode: e.value } })} />
        </Row>
        {ranking && (
          <>
            <Row label="How many">
              <NumberBox {...box} width={84} min={1} showSpinButtons value={rank.count ?? 5}
                onValueChanged={e => onChange({ rank: { ...rank, count: e.value } })} />
            </Row>
            <Row label="By" hint={rank.key ? null : 'Choose the property to rank by'}>
              <SelectBox {...box} dataSource={properties} valueExpr="key" displayExpr="label" value={rank.key || null}
                placeholder="Property…" searchEnabled onValueChanged={e => onChange({ rank: { ...rank, key: e.value } })} />
            </Row>
          </>
        )}
      </Section>
    </>
  );
}
