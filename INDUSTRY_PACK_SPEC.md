# Industry Pack Spec — adding a new simulated industry to Aetherium

Read this before generating a new industry model. It's the full
requirements list: what to research, how to design the asset model, what
files to produce, the rules they follow, and how to check the result.
Read `PROJECT_CONTEXT.md` first for the app itself.

**How Amy will use this:** "Add a new industry: `<industry>`. Follow
`INDUSTRY_PACK_SPEC.md`." That request plus this file should be enough to
do the whole job. The only things to ask Amy up front are in §0.

> **Status (v2, Sept 2026).** This version describes the **generic**
> pack format: any hierarchy depth, uneven branches, and data keyed
> directly by asset id. It is the **only** format. The three original
> packs (refinery, water, wastewater) were converted to it, and the older
> formats and their code paths were deleted (§12). §11 lists what was
> built and what is still open.

---

## 0. Before starting — ask Amy (one batch)

1. **Which industry, and how specific?** (for example "onshore wind farm",
   "combined-cycle gas plant", "pipeline compressor station").
2. **Site and asset names.** Fictional names, like Aurelia, Meridian and
   Confluence.
3. **What should this model show off?** Deep and narrow, wide and
   shallow, branches with different structures, many similar assets,
   several relationship layers…? The existing models are listed in
   `public/data/models.json`, so pick a shape they don't already cover.
4. **Anything the demo audience cares about?** (a customer segment, a
   failure they'll recognize, a KPI they'll look for).

If Amy isn't around to answer, pick sensible defaults, write them at the
top of `RESEARCH.md`, and carry on.

---

## 1. Deliverables checklist

| # | Deliverable | Where |
|---|---|---|
| 1 | Research brief (process, hierarchy, KPIs, failure modes, sources) | `ModelAndData/industries/<model>/RESEARCH.md` |
| 2 | Scenario sheet (each scenario's story, timeline and data footprint) | `ModelAndData/industries/<model>/SCENARIOS.md` |
| 3 | Deterministic generator script (fixed seed, rerunnable) | `ModelAndData/industries/<model>/generate.py` |
| 4 | The 8 runtime JSON files (§6) | `public/data/<model>/` |
| 5 | The `models.json` entry (§9) | `public/data/models.json` |
| 6 | A validator run with zero errors (§8) | `ModelAndData/tools/validate_industry_pack.py <model>` |
| 7 | Browser check: switch to the model, then click through Configurator → Types/Assets and Operator → Attention/Assets/Investigate, with screenshots | Claude's sandbox (per `PROJECT_CONTEXT.md`) |
| 8 | Detectors, one per failure mode behind an attention item (§14) | `ModelAndData/industries/<model>/explain.py` |
| 9 | Explanations: the "why" behind each attention item (§14), listed in the pack's `models.json` `"files"` block (§14.7) | `public/data/<model>/explanations.json` |
| 10 | Robustness run: detectors on regenerated data (§14.6) | `ModelAndData/industries/<model>/robustness.py` |

`<model>` is a short lowercase slug with no spaces (for example `wind`).
It's the folder name, the `models.json` id, and the key used by
`nowSelectionStorage`.

Commit the generator. The three original packs (refinery, water,
wastewater) have none; they were converted once from hand-built data
(§12) and can't be regenerated. Don't repeat that.

**Worked example:** `ModelAndData/industries/wind/` (Boreas Ridge) is
the first generic pack. It has all three documents plus a generator
that reads its scenario constants from one block and derives the
attention-item evidence from the generated series. Start a new pack by
reading it.

---

## 2. Phase 1 — Research (RESEARCH.md)

Research with web search before designing anything. Aim for about 75%
realism and 25% demo clarity (the target set during the ChatGPT design
sessions in `ModelAndData/ChatGPT_2026082*.txt`): real terms, real units,
plausible magnitudes and real failure physics, simplified wherever realism
would make a demo hard to follow.

RESEARCH.md must cover:

1. **Process overview.** What the site produces or does, and how material,
   energy or signals move through it.
2. **The natural hierarchy.** How people in this industry break the site
   down (site → area → unit → system → equipment, or whatever their own
   words are). Use those levels and names; don't force the industry into
   another industry's shape. Note where branches really differ (two
   equipment generations, optional systems), and the realistic counts at
   each level.
3. **The unit of operation.** The level an operator thinks of as "a
   thing I run", which gets its own status tile (a treatment train, a
   turbine, a compressor unit). This becomes `unitLevel` (§3.1).
4. **KPIs and properties.** For each asset type: what's measured, in what
   unit, the typical normal range, and which 1–2 numbers an operator
   watches most. Include the industry's headline KPIs (availability,
   capacity factor, OEE, heat rate, whatever applies) and how they roll
   up from child assets to parents. Cite sources.
5. **Failure modes.** At least 12 real, documented failure or abnormal
   modes, each with: the asset involved, the physical cause, the first
   measurable symptom, how it spreads to related assets, how operators
   confirm it, the usual fix, and a typical timescale (minutes, hours or
   days). Cite sources: trade and regulator documents, OEM notes, operator
   training material, incident reports.
6. **Normal-operation context.** Operating modes, products or grades (or
   their equivalent), and typical routine work (rounds, inspections,
   sampling, permits, handovers).
7. **Sources.** A list of links.

---

## 3. Phase 2 — Model design

### 3.1 Hierarchy

The hierarchy is a tree of assets. Each model declares its own levels, in
order from root to leaf, in `models.json` (§9).

- **Depth:** 3–7 levels. Every asset sits exactly one level below its
  parent. A branch can stop early: a leaf can be at any level, so a simple
  pump can have no component children while its neighbour does.
- **Width:** whatever is realistic. Counts can differ between branches (a
  feeder with 7 turbines next to one with 10). There is no required count
  at any level; see the budgets in §7.
- **Roots:** one or more assets with `parentId: null`, all at the first
  level. More than one root is fine, for example two sites.
- **`unitLevel`:** one declared level whose assets are the units of
  operation. Each one gets a Now-strip tile, a status and an operating
  context (§6.6), and every attention item names one (§6.7). It's usually
  the level right under the site, but it doesn't have to be.
- **Types.** A type is (`assetLevel`, `assetType`), and an `assetType`
  belongs to exactly one level. Every instance of a type has **the same
  property keys**, because the Configurator shows and saves display
  settings per type, so a type must mean one consistent set of values.
  Instances should also have the same *kinds* of children. If they don't,
  decide which of two cases it is:
  - The asset itself is different (a geared turbine has a gearbox, a
    direct-drive turbine doesn't): make it **two types**.
  - It's a container that just holds a mix (a feeder with some turbines
    of each kind): keep **one type**. The validator warns about it, and
    that's expected.
- **Heterogeneity is encouraged.** Branches with different structures,
  optional subsystems and mixed generations are exactly what shows the
  app handles real-world models. Say where and why in RESEARCH.md.

### 3.2 IDs, names and labels

The generic format has **no id-derivation rules**. The app never builds
one id from another; every file refers to assets by their real `id`.

- **`id`:** unique across the model, stable, `UPPER_SNAKE_CASE` using
  only `A–Z`, `0–9` and `_`. Recommended (not required) form: the
  parent's id plus `_` plus a short code, for example
  `BOREAS_F2_WTG07_GEARBOX`. That keeps ids readable in logs.
- **`assetType`:** lowercase `snake_case`, unique within its level
  (`gearbox`, `pitch_system`).
- **`name`:** the display name, unique among siblings. Short codes are
  fine where that's how the industry refers to them (`WTG-07`, `F2`).
  Repeated equipment names under different parents are expected
  ("Gearbox" in every turbine).
- **Display label:** the app shows an asset in context as the names on
  its path, joined with `' · '` (U+00B7 with spaces), starting at the
  unit-level ancestor, for example `WTG-07 · Gearbox`. Attention and work
  items store this label (`asset`, `assetLabel`) for display, next to the
  id they actually use (§6.7, §6.8).

### 3.3 Property keys

- Use `snake_case` and put the **unit at the end** when there is one:
  `bearing_temp_c`, `active_power_kw`, `wind_speed_ms`, `level_pct`.
  Unitless indices end in `_index` or `_score`.
- **Metadata is global to the model, keyed by property name alone.** One
  label, unit, category, tier and range per key. So:
  - Reuse a key across types only when it means the same thing and has
    the same normal range.
  - When a similar measurement has a very different magnitude, give it a
    **different key**. The water packs use `motor_current_a` for small
    dosing pumps and `process_motor_current_a` for large process pumps, so
    each gets its own gauge range.
- **Reusable property kits** keep equipment consistent. From the water
  and wastewater packs:
  - Centrifugal process pump: `flow_rate_gpm`, `discharge_pressure_psi`,
    `process_motor_current_a`, `vibration_mms`, `bearing_temp_c`
  - Metering or dosing pump: `dosing_flow_rate_gpm`,
    `discharge_pressure_psi`, `motor_current_a`, `vibration_mms`,
    `bearing_temp_c`
  - Storage tank: `level_pct`, `consumption_rate`, `temperature_c`
  - Basin or vessel: `level_pct`, `residence_time_min`
  - Blower: `air_flow_scfm`, `blower_discharge_pressure_psi`,
    `discharge_temp_c`, `vibration_mms`

  Add new kits (gearbox, generator, converter, compressor, heat
  exchanger, turbine…) when the industry needs them, and reuse them
  across that model.
- **How many per type:** about 2–8. Operators should see the handful
  that matter, not everything a historian stores. Container assets (a
  site, a feeder, an area) usually carry derived headline KPIs (§3.5). A
  type with no properties at all is allowed, but it shows an empty
  preview in the Configurator, so give it at least one if you can.
- **Static properties** (nameplate values like `rated_power_kw`) are
  allowed. They go in the current-values file but have no time series,
  and must be marked `static: true` in their metadata.

### 3.4 Property metadata (`properties.json` → `properties`)

For **every** key used by any asset:

- **`label`:** short and human-readable, no unit ("Bearing Temperature").
- **`unit`:** display unit string (`"°C"`, `"kW"`, `"%"`), or `""` for
  indices.
- **`category`:** prefer the six the Operator views already group by, in
  this order: `Flow / WIP`, `Events / Losses`, `Stability`, `Quality`,
  `Derived Metric`, `Condition`. Industry-specific extras are allowed
  (for example `Electrical`, `Environmental`); the UI lists them after
  the six. Keep the model to at most 8 categories in total.
  - Condition is for equipment health (vibration, temperatures, current,
    pressure drop).
  - Quality is for product or output quality.
  - Stability is for control and oscillation signals.
- **`tier`:** `P1` (always shown), `P2`, or `P3` (shown only at "max").
  This set is fixed by the UI's visibility filter. Aim for roughly 35% P1,
  45% P2, 20% P3. The 1–2 numbers an operator watches most per type are
  P1.
- **`range`:** `[min, max]` for the gauge. Normal operation should sit in
  the middle 30–70% of the range, and scenario excursions should still
  fit inside it.
- **`decimals`** (optional): display precision.
- **`static`** (optional, default `false`): see §3.3.

### 3.5 Derived (rollup) properties (`properties.json` → `derivations`)

Parent-level KPIs are computed from their descendants, and the rule is
written down as data:

```jsonc
{ "assetType": "feeder", "property": "active_power_kw",
  "fn": "sum", "of": "active_power_kw", "fromType": "wind_turbine_geared|wind_turbine_dd", "scope": "descendants" }
```

- `fn` is one of `sum`, `mean`, `min`, `max`, `count` (count of
  descendants matching a condition goes in RESEARCH.md and is precomputed).
- `fromType` is one or more `assetType`s joined by `|`.
- `scope` is `children` or `descendants`.
- It applies at **every time point**, not only "now". The validator
  checks this.
- Ratios and industry formulas (availability, capacity factor, OEE)
  that aren't a simple aggregate are documented in `generate.py` and
  RESEARCH.md, and listed with `"fn": "formula"` and a `note`. The
  validator then skips them.

### 3.6 Relationships (`asset-relationships.json`)

Schema: `{ sourceAssetId, targetAssetId, relationshipType, label, layer }`.

- Edges can connect **any two assets at any levels**, including across
  branches (a turbine's transformer feeding its feeder, a feeder feeding
  the site substation).
- **Containment is not an edge.** It already comes from `parentId`, and
  the app draws it separately.
- `relationshipType` is `feeds_into` for every existing edge. Add a new
  type only if Amy agrees it's needed.
- `label` is `null` unless the edge needs explaining ("return activated
  sludge", "reverse flow during backwash").
- `layer` is required. Use one or more industry layers (`process_flow`,
  `power`, `steam`, `cooling_water`, `lube_oil`, `air_flow`,
  `chemical_dosing`, `comms`…). An asset can have edges on several
  layers.
- Real cycles are fine when the process has them.
- Assets with no flow relationship (a mixer acting on its own vessel) can
  have no edges. Write down which ones and why in RESEARCH.md.

---

## 4. Phase 3 — Scenarios (SCENARIOS.md → attention and work items)

### 4.1 The scenario portfolio

The scenario set was designed in the ChatGPT sessions as 14 archetypes in
5 families. Each one tests a different part of the operator loop: *Orient
→ Evaluate → Anticipate → Triage → Diagnose → Decide → Act → Verify →
Preserve*. A new industry **maps these archetypes onto its own real
failure modes** from RESEARCH.md rather than inventing new ones.

| # | Archetype | Ground truth (generic) | First evidence |
|---|---|---|---|
| 01 | Normal shift | Everything healthy | None. No attention item: the system stays quiet |
| 02 | Busy-but-normal | Healthy, with a lot of planned work | Work deadlines approaching |
| 03 | Quiet drift | Efficiency slowly getting worse | Output ↓ while control effort ↑ |
| 04 | Accumulation or saturation | Downstream capacity < incoming flow | Level or inventory steadily rising |
| 05 | Component degradation | Bearing, seal or membrane wearing | Vibration or temperature ↑ at the same load |
| 06 | Signal noise | Faulty instrument, healthy process | Erratic signal that nothing else confirms |
| 07 | Ghost signal | Symptom shows downstream, cause is upstream | Problem appears at a later asset |
| 08 | Throughput illusion | Headline rate hides losses | Hidden losses ↑, headline rate looks fine |
| 09 | Cascade failure | Upstream fault spreads downstream | Upstream interruption, then downstream disturbances |
| 10 | Overcorrection loop | Manual and automatic corrections amplify each other | Oscillation growing |
| 11 | Hard block | Physical obstruction or trip | Output → 0 suddenly |
| 12 | Recurring micro-events | Small repeated interruptions add up | Event frequency above normal |
| 13 | Quality drift | Input or process shift heading toward a limit | Quality falling while output stays healthy |
| 14 | Plan or compliance at risk | Healthy equipment, a deadline or prerequisite at risk | Time needed is greater than time left |

**Coverage:**

- **6–14 attention items**, covering at least 6 different archetypes.
  Include at least one each of 05 (degradation), 06 (instrument versus
  process) and 07 (upstream cause), plus 09 or 11 (acute event).
  Archetype 01 never gets an attention item.
- Spread the items across at least 4 unit-level assets (or all of them,
  if there are fewer) and at least 4 asset types, and at more than one
  hierarchy level. At least one item should be on a non-leaf asset.
  Items can sit above the unit level too (a feeder trip, a site-wide
  curtailment); those have `unitId: null`.

Include a mix of outcomes as of "now":

- about half **resolved** (`attentionState: 'watch'`, `outcomeStatus:
  'resolved'`)
- at least 1 **recovering**
- at least 2 still **open** (`investigate` or `act`, with
  `outcomeStatus: 'none'`)
- at least one `act` item and at least one `high` severity item
- at least one item that started within 30 minutes of now (lights the
  "new" dot on the Attention icon)

### 4.2 The timeline

Each model declares its own timeline in `asset-telemetry.json` (§6.5):

```json
"timeline": { "date": "2026-08-28", "start": "08:00", "end": "14:05", "stepMinutes": 5 }
```

- `end` **is "now"** for that model. Everything "as of now" (snapshots,
  `sinceMinutes`, work-item lateness) is measured from it.
- One calendar day, `HH:MM` times, `start` < `end`, and `end − start`
  divisible by `stepMinutes`. `stepMinutes` is 1, 2, 5, 10 or 15.
- **Default** (use it unless the industry clearly calls for something
  else): 08:00–14:05 at 5 minutes, 74 points, on 2026-08-28. That keeps
  all models on the same demo day. A different step can be worth it: wind
  SCADA naturally reports 10-minute averages, and compressor surge events
  need 1–2 minutes.
- Aim for 40–200 points per series (§7).
- Every scenario's `evidencePoints` times are on the grid and inside the
  window.
- `sinceMinutes` for a resolved item = minutes from its resolution time
  to `end`; for an open item = minutes from its start to `end`. The
  `since` text must agree: `"Resolved 2h 35m ago"`, `"5h 35m ago"` or
  `"55m ago"`.

### 4.3 What SCENARIOS.md records per scenario

id, archetype #, the asset id it's on, the root-cause asset (if
different), the primary property, the secondary properties and how each
responds, the start, peak, intervention and recovery times, the related
assets affected (via which relationship layer) and their lag, the
ruled-out alternatives, the related work items, and a research citation
for why it's realistic. The generator reads the same numbers (keep them
as a table or dict at the top of `generate.py`), so the story and the
data can't drift apart.

---

## 5. Phase 4 — Generating telemetry

### 5.1 Baseline (normal) behaviour

- Every non-static numeric property of every asset has a series with one
  point per timeline step.
- Model normal operation as a **slowly drifting AR(1) process around a
  per-asset setpoint**, not white noise. The original packs' data has lag-1
  autocorrelation of about 0.8–0.95. Typical coefficient of variation:
  about 0.2–2% for tightly controlled values, about 5–15% for loosely
  controlled ones. Counts and queues can hit 0.
- **Drive related values from a shared cause** where the physics does it
  (wind speed → rotor speed → power → gearbox temperature), not as
  independent noise. That's what makes the Investigate views convincing.
- Give sibling assets slightly different setpoints or efficiencies
  (about ±1–3%) so there's a real best and worst.
- **Stay within physics:** percentages stay within 0–100, except ratios
  that can really exceed it (performance against a curve, transformer
  load); declare those with a range above 100. Counts are ≥ 0, and values
  stay inside their metadata `range`.
- Round stored values to 3 decimals or the key's `decimals`. Use a fixed
  random seed.

### 5.2 Injecting a scenario (its footprint in the data)

For each attention item, the generator must write the story into the
telemetry, not just into the narrative text:

1. **Primary property** on the item's asset follows the
   `evidencePoints` values at their exact times (with a little noise in
   between), shaped by the archetype (ramp, step, oscillation, spike and
   recovery…).
2. **Root cause:** if the cause is on a different asset (a child
   component, an upstream asset), that asset's own condition signals
   change in the physically right direction, **starting before or with**
   the visible symptom.
3. **Related effect:** at least one related asset (through a
   relationship edge or the parent chain) responds after a realistic lag.
   Archetype 06 (instrument fault) is the exception: nothing related
   confirms it, and that absence is the point.
4. **Headline KPIs** on the item's asset and its ancestors dip or rise by
   a believable amount through the derivations (§3.5), and recover
   afterward if the item was resolved.
5. **Recovery** after the intervention time, with realistic lag. Open
   items are still abnormal at "now".

`evidence` (the number array) = the numeric values of `evidencePoints`,
in order. For non-numeric evidence (event counts, task states), use small
integer codes as the refinery and water packs do.

### 5.3 The "current value" rule

For every asset and every non-static property,
`asset-values[assetId][key]` **equals the last point** of
`asset-telemetry.series[assetId][key]`, exactly. The Investigate time
scrubber depends on this. Static properties appear only in
`asset-values`.

---

## 6. File contracts — the 8 files in `public/data/<model>/`

(Plus an optional ninth, `explanations.json`, written by the pack's
detectors rather than its generator. See §14.)

| # | File | Role | Contents |
|---|---|---|---|
| 1 | `assets.json` | assets | the hierarchy |
| 2 | `asset-relationships.json` | assetRelationships | relationship edges (§3.6) |
| 3 | `properties.json` | properties | property metadata + derivations |
| 4 | `asset-values.json` | assetValues | current value of every property |
| 5 | `asset-telemetry.json` | assetTelemetry | timeline + series |
| 6 | `unit-status.json` | unitStatus | status and operating context per unit |
| 7 | `attention-items.json` | attentionItems | situations |
| 8 | `work-items.json` | workItems | tasks |

### 6.1 `assets.json`

```jsonc
[{ "id": "BOREAS", "parentId": null, "name": "Boreas", "assetType": "wind_site", "assetLevel": "site" }, …]
```

Order it as a depth-first walk (parent, then its children, recursively),
so the tree reads naturally.

### 6.2 `asset-relationships.json`

An array of edges (§3.6).

### 6.3 `properties.json`

```jsonc
{
  "properties": {
    "gearbox_oil_temp_c": { "label": "Gearbox Oil Temperature", "unit": "°C", "category": "Condition", "tier": "P1", "range": [20, 95], "decimals": 1 },
    "rated_power_kw":     { "label": "Rated Power", "unit": "kW", "category": "Derived Metric", "tier": "P3", "range": [0, 5000], "static": true }
  },
  "derivations": [ { "assetType": "feeder", "property": "active_power_kw", "fn": "sum", "of": "active_power_kw", "fromType": "wind_turbine_geared|wind_turbine_dd", "scope": "descendants" } ],
  "typeLabels": { "hs_bearing": "HS Bearing", "wind_turbine_dd": "Wind Turbine (Direct Drive)" }
}
```

`typeLabels` (optional) gives a display name for an `assetType` where
turning the slug into words reads badly: the app would otherwise show
`hs_bearing` as "Hs Bearing".

### 6.4 `asset-values.json`

`{ [assetId]: { [key]: number } }`. Every asset with properties. Keys
match that asset's type exactly (§3.1).

### 6.5 `asset-telemetry.json`

```jsonc
{
  "timeline": { "date": "2026-08-28", "start": "08:00", "end": "14:05", "stepMinutes": 5 },
  "timestamps": ["08:00", "08:05", …, "14:05"],
  "series": { [assetId]: { [key]: [number, …] } }
}
```

`timestamps` is written out in full (it must match `timeline`) so the UI
never has to rebuild it.

### 6.6 `unit-status.json`

One entry for **every asset at `unitLevel`**:

```jsonc
{ "BOREAS_F2_WTG07": { "state": "attention", "statusSinceMinutes": 95, "mode": "CURTAILED", "product": "Grid export" } }
```

- `state` is one of `running`, `attention`, `changeover`, `down`. These
  are the states the Now strip has colors and icons for; a new state
  needs a small code change. A unit with an open attention item is
  `attention`, with `statusSinceMinutes` = the minutes since its oldest
  open item started.
- `mode` is ideally one of the colored modes: `STEADY`, `CHANGEOVER`,
  `RAMP_UP`, `RAMP_DOWN`, `STOPPED`, `MAINTENANCE`, `CONTROLLED_HOLD`.
  Industry-specific modes (such as `CURTAILED`) are allowed; they show in
  a neutral color until one is added.
- `product` is what the unit is making or delivering, in industry terms
  (grade, product, "Grid export", "Potable supply").

This replaced the original packs' `line-status.json` and
`operating-context.json`.

### 6.7 `attention-items.json`

```jsonc
{
  "id": "BSIT01",                           // unique across ALL models: pick a new prefix (SIT, WSIT, … are taken)
  "assetId": "BOREAS_F2_WTG07_GEARBOX",     // the asset the situation is about, at any level
  "unitId": "BOREAS_F2_WTG07",              // its unit-level ancestor (or itself); null if the asset sits above the unit level
  "primaryProperty": "gearbox_oil_temp_c",  // the property evidencePoints track; must exist on assetId
  "asset": "WTG-07 · Gearbox",              // display label (§3.2)
  "line": "WTG-07",                         // display name of the unit (the Attention list groups by it); the asset's own name when unitId is null
  "severity": "high|medium|low",
  "signal": "One-line headline, operator voice",
  "aiInterpretation": "One or two sentences: what the AI thinks is going on",
  "since": "Resolved 2h 35m ago",
  "sinceMinutes": 155,
  "attentionState": "urgent|act|investigate|watch",
  "detail": {
    "signal": "…specific numbers, times…",
    "observed": "raw facts", "derived": "computed or correlated facts", "inferred": "hypothesis",
    "recommendation": "what to do",
    "evidence": [61.2, 63.0, …],
    "evidencePoints": [{ "time": "09:40", "value": "61.2 °C", "label": "Baseline" }, …],   // 5–8 points, on the grid, labels on the key moments and "" elsewhere
    "relatedOccurrences": [{ "date": "2026-07-14", "summary": "…" }],                     // 0–2 past occurrences; [] if none
    "whatChangedSummary": "one sentence",
    "whatChanged": [{ "time": "11:32", "source": "Operator Action|Maintenance|Field Check|Event|Alarm|Setpoint Change|…", "description": "…", "related": true }],
    "confidence": "Confirmed by inspection", "confidenceLevel": "high|medium|low|n/a",
    "risk": "Low — caught before …", "riskLevel": "high|medium|low|none",
    "expectedOutcome": "…", "outcomeStatus": "resolved|recovering|none"
  }
}
```

For items still open at "now", don't put the confirmed root cause in the
text. The AI shouldn't know the answer before its own diagnosis gets
there (a design decision from the Aug 27 sessions).

### 6.8 `work-items.json`

```jsonc
{
  "id": "wk-b01", "text": "Short task title", "description": "…",
  "assetId": "BOREAS_F2_WTG07",           // any level, or null for site-wide
  "assetLabel": "WTG-07",                 // display label, or null
  "workType": "SAMPLE|INSPECTION|HUDDLE|MAINTENANCE|INSTRUMENT_CHECK|DOCUMENTATION|QUALITY_CHECK|PROCEDURE|CHANGEOVER|MATERIAL_STAGE|QUALITY_RELEASE|PERMIT|…",
  "priority": "urgent|important|routine",
  "sourceType": "planned|situation", "sourceLabel": "From: Gearbox oil temperature climbing" /* null for planned */, "source": "operator|ai",
  "assignedRole": "Operator|Field Operator|Maintenance|Quality|Materials|…",
  "plannedStart": "2026-08-28T08:15:00", "dueAt": "2026-08-28T08:15:00",
  "estimatedDurationMinutes": 15,
  "done": true, "completedAt": "2026-08-28T08:22:00",   // null when not done
  "createdAt": "2026-08-28T08:00:00"
}
```

- Times are local ISO with no `Z`, on the timeline's date.
- About half are planned routine work from RESEARCH.md; half are created
  from situations (`source: "ai"`, `sourceType: "situation"`), each on
  the same asset as its attention item, with `sourceLabel: "From: <that
  item's situation>"` (the same format the app uses when an operator
  creates a task from Investigate).
- `workType` and `assignedRole` can use industry-specific values. The UI
  displays them as text.
- Leave 2–4 not done, with at least one due after "now".

---

## 7. Budgets — and why each number exists

These are the only numeric limits. Each has a reason; if the reason goes
away, so should the limit.

| Budget | Value | Why |
|---|---|---|
| Hierarchy depth | 3–7 levels | Under 3 there's nothing to show; over 7 the tree and breadcrumbs get hard to read. |
| Total assets | ≤ 400 (soft) | The All Assets diagram draws every asset as a property box and lays them all out with ELK. Measured in headless Chromium: 127 assets are ready in about 2.2 s, and a synthetic 389-asset, 5-level pack in about 4.3 s, with the page still responsive afterwards. Past 400, plan on hiding assets from that view by default. |
| Children per parent | ≤ 40 (soft) | Beyond that, the tree and the cards views get hard to scan. |
| Units (`unitLevel` assets) | ≤ 24 (soft) | One Now-strip tile each. The refinery's 12 fit comfortably; past about 24 the strip scrolls sideways (tested with 34). The Now strip is currently hidden by CSS (`.op-now-section`), so this only matters once it's shown again. |
| Properties per type | about 2–8 | What an operator can take in at a glance (§3.3). |
| Distinct property keys | no fixed number | Follows from the types; the old 40–55 target only described the original packs. |
| Points per series | 40–200 | Enough shape for a trend, small enough for fast files. |
| Total pack size | ≤ 5 MB, no file over 3 MB | Everything loads at once when switching models. Refinery, water and wastewater are about 0.3–0.45 MB each. |
| Attention items | 6–14 | Enough to cover the required archetypes (§4.1), few enough for the Attention list to stay meaningful. |
| Work items | 8–15 | A believable shift's workload. |
| Evidence points per item | 5–8 | What the Timeline and Table cards display well. |

Rough size check: *assets with series × properties × points × about 7
bytes*. 300 assets × 4 properties × 74 points ≈ 620 KB.

Numbers from v1 that **were removed**, because they only described the
original packs: exactly 4 levels; 1 plant; 6 trains; 5–6 stages per train;
2–3 equipment per stage; 30–36 stages; 80–100 equipment; 60–75 edges;
edges only between equipment in the same train; 8 fixed "universal"
properties on every stage; fixed line and plant KPI key sets; the OEE
formula; the six categories being the only ones allowed; the fixed shared
timeline.

---

## 8. Validation (required before handing anything back)

Run:

```
python3 ModelAndData/tools/validate_industry_pack.py <model>
python3 ModelAndData/tools/validate_industry_pack.py --all   # every pack in models.json
```

It checks:

- **Registration:** the `models.json` entry and its levels.
- **Hierarchy:** one level per depth step; roots at the first level;
  unique ids and sibling names; same-type consistency (§3.1).
- **Coverage:** `unitLevel` coverage in `unit-status`.
- **Properties:** every key has metadata; metadata values are allowed;
  static keys have no series; non-static keys have one.
- **Values and series:** series lengths and timestamps match `timeline`;
  the current-value rule (§5.3); values within ranges; percentages 0–100.
- **Derivations** at every time point.
- **Relationships:** endpoints exist; every edge has a layer.
- **Attention and work items:** schemas; that `assetId`, `unitId` and
  `primaryProperty` resolve; evidence times on the grid; `since` and
  `sinceMinutes` agree.
- **Scenario coverage** minimums (§4.1).
- **Budgets** (§7).
- **Explanations** (§14), when `explanations.json` is present.

Errors must be zero. Warnings need a reason, written down in
SCENARIOS.md.

Then do the browser check from `PROJECT_CONTEXT.md` with the new model
selected, and actually look at the screenshots:

- Configurator: the Types and Assets tabs list the new types and assets,
  including assets at every level; property previews show gauges with
  ranges and units.
- Operator: the Attention list; Investigate (Trend, Assets, and the time
  scrubber moving real values); the Assets view with a Diagram of the
  relationships; the Now strip showing one tile per unit.

---

## 9. Registering the model (`public/data/models.json`)

```jsonc
{
  "id": "wind",
  "label": "Wind",
  "levels": [
    { "id": "site", "label": "Site" },
    { "id": "feeder", "label": "Feeder" },
    { "id": "turbine", "label": "Turbine" },
    { "id": "subsystem", "label": "Subsystem" },
    { "id": "component", "label": "Component" }
  ],
  "unitLevel": "turbine"
}
```

- `id` matches the folder `public/data/<id>/`. `label` is what the
  model switcher shows; entries appear in file order.
- `levels` lists every `assetLevel` used in `assets.json`, root first.
  Their `label`s replace the app's hardcoded level labels.
- `unitLevel` is one of those level ids.
- `files` (optional) maps a role to a filename, merged over the §6
  defaults. Packs use it only to add the optional `explanations` role
  (§14.7); an unknown role is an error on load.

---

## 10. Model-specific UI

None. Every Operator and Configurator view reads the generic files. The
refinery-only Issue Map and Line Detail panels were removed along with
the legacy formats (§12); a Now-strip tile opens its unit in the Assets
area for every model.

The **designer** (the Screens Model tab and the Wizard) still reads the
refinery hierarchy from `src/assetData.js`, whose ids match
`public/data/refinery/assets.json`. Moving it onto the loaded model is
open (§11).

---

## 11. Implementation status

Built (Sept 2026):

1. **Registry** (`modelRegistry.js`): `levels` and `unitLevel` checked
   on load, the §6 default filenames, and optional roles
   (`explanations`) that may be missing without failing the model.
2. **Loader** (`OperatorWorkspace.jsx`): loads the 8 files, and splits
   `properties.json` into the label, category, tier, range, unit, decimals
   and type-label lookups. It resets **every** model variable before each
   load, so nothing leaks from one model into the next.
3. **Property lookup:** `getAssetProperties(assetId)` reads
   `asset-values[assetId]` and `getAssetPropertySeries(assetId, key)`
   reads `asset-telemetry.series[assetId][key]` (`assetQueries.js`).
   There are no id conversions; type ids are `assetTypeIdOf(asset)`.
4. **Timeline:** `applyTimeline()` sets "now", the shift start and the
   sample grid from the model. The
   scrubber, slicing, work-item lateness and chart dates all follow it.
5. **Level labels** come from `models.json`. Display labels start at the
   unit-level ancestor.
6. **Now strip:** tiles come from `unit-status.json`, and a tile click
   opens that unit in the Assets area. The tree expands down to it.
7. **Attention and work items** resolve by `assetId`. The Trend chart
   plots the real `primaryProperty` series across the whole timeline.
8. **Units and decimals** are shown in the stat tiles.
9. **Scale check:** done (see §7).
10. **Validator:** checks every pack (§8); `--all` runs the whole
    registry.
11. **Original packs converted** (§12): refinery, water and wastewater
    are generic packs; the legacy files, loader branches, id-conversion
    helpers, Issue Map and Line Detail are gone.

Still open:

- Moving the designer (Screens Model tab, Wizard) off `src/assetData.js`
  onto the loaded model, then deleting that file.
- The converted packs' remaining validator warnings (refinery types with
  more than 8 properties, and scenario-coverage gaps in water and
  wastewater), and aligning a few refinery evidence times (SIT09, SIT11)
  with their narratives.
- `derivations` are validated but not yet used by the UI (for example, to
  explain where a rollup comes from).
- `explanations.json` (§14) exists for wind, ccgt and pipeline, not yet
  pharma or grid. Those two keep the plain AI tab until they get
  detectors.

---

## 12. The original packs' conversion (record)

Refinery, water and wastewater were built before this spec in two older
layouts: `shape: "refinery"` (hierarchy in `src/assetData.js`) and
`shape: "four-level"` (hierarchy in `water-asset-data.json`), each about
20 files with per-level telemetry and "station" ids derived from asset ids
by string rules (spec v1, commit `8515fdd`). They were converted once, in
Sept 2026, by `ModelAndData/tools/convert_legacy_to_generic.py`, run
against commit `004d401` (the last commit with the old files):

```
git worktree add ../aetherium-legacy 004d401
python3 ModelAndData/tools/convert_legacy_to_generic.py --src ../aetherium-legacy
```

What the conversion kept: every asset id, `assetType` and `assetLevel`
(so saved layouts and customizations still apply), every numeric
property key of water and wastewater, and all attention and work items.

What it changed:

- **Refinery instrument tags** became spec keys, and every station now
  has them as properties: `BearingTempC` → `bearing_temp_c`,
  `PressurePV` → `process_pressure_psi`, `TransferRate` →
  `transfer_rate_per_min`, `VibrationMmS` → `vibration_mms`, and so on.
  Each station also gained `throughput_per_min`.
- **Text properties** (`bottleneck_station`, `best_*`/`worst_*`) were
  dropped.
- **Percentages** were clamped to 0–100, and negative noise on times,
  rates and indices clamped to 0 (signed offsets kept).
- **Plant rollups** were recomputed from the lines at every point and
  declared as `derivations`.
- **Attention items** got `assetId`, `unitId` and `primaryProperty`;
  evidence was snapped onto the 5-minute grid, and each primary series
  now passes exactly through its evidence values.
- **Work items** lost the stray `Z` (UTC) suffix and resolve by `assetId`;
  "Meridian & Confluence" items point at the Meridian plant.
- Missing ranges were derived from the data; every property declares
  `decimals`.

The converter is kept for the record and as a template; there is nothing
left to convert.

---

## 13. Definition of done

- [ ] RESEARCH.md and SCENARIOS.md written, with sources, including why
      this hierarchy shape was chosen
- [ ] `generate.py` committed, deterministic, and it regenerates every
      JSON file from scratch
- [ ] all 8 JSON files present, and the `models.json` entry added
- [ ] the validator shows 0 errors, and every warning has a reason in
      SCENARIOS.md
- [ ] the model loads with no console errors, and screenshots of the
      Configurator and Operator views have been reviewed
- [ ] `explain.py` explains every attention item, fires nowhere else (or
      the extra detections are listed in SCENARIOS.md with a reason), and
      `robustness.py` finds every item on 10 regenerated datasets (§14)
- [ ] handed to Amy as a zip of full files in repo folder layout (her
      laptop blocks some single-file downloads), with a short note on the
      scenarios and which archetypes they cover

---

## 14. Detectors and explanations (`explain.py` → `explanations.json`)

An attention item says *what* needs attention. Its explanation shows *why*
the system thinks so, the way an experienced engineer would: the evidence
checked against the known signature of the failure, what else could cause
the same symptom and why it doesn't fit, what the failure looks like in
reference examples, and how sure the system is. The operator should be able
to check the reasoning, not just trust it.

### 14.1 The rule that keeps it honest

**Detectors read only the runtime files**, through
`ModelAndData/tools/detectors/pack.py`, exactly as the app would. They
never import the generator or read its scenario constants. The runner
evaluates each detector on **every** asset it applies to (all 19 HS
bearings, not just the one with a story), so a detector that fires
everywhere, or nowhere, shows up immediately.

### 14.2 What to build

One detector per attention item's failure mode, written in
`ModelAndData/industries/<model>/explain.py` from the shared toolkit in
`ModelAndData/tools/detectors/`:

- `pack.py`: read-only access to the runtime files, including the
  hierarchy and relationship layers (`sources` and `targets`).
- `blocks.py`: the signal building blocks. Running masks, an
  expected-value model fitted on peers (`fleet_expected`), residuals,
  slope per hour, largest single step, sustained-since, peer min/median/max,
  episodes.
- `build.py`: the `Detector` base class, the builders for charts, checks,
  rule-outs and reference examples, and `run_pack`, which runs everything
  and writes the file.

Each detector has:

- a `definition` dict: inputs, peers, the expected-value model, **every
  threshold in `params`** (the code reads them from there, so what the
  engineer view shows can't drift from what runs), the checks with their
  roles, and the confidence rule;
- `candidates(pack)`: every asset it applies to;
- `evaluate(pack, aid)`: returns a `Finding` that fired at the first time
  point where every required check held, or didn't fire;
- `explain(pack, finding, item)`: builds the explanation from the finding
  and the data.

Checks come in two roles:

- **required:** the detector only raises when all of them match;
- **supporting:** each one that matches raises confidence. Mark the ones
  that come from an independent sensor (`independent: true`); confidence
  depends on those.

Each check carries its own evidence: `value` is the numbers in a sentence,
`why` is the physics in a sentence, and `spark` is a small chart.

### 14.3 What each explanation contains

`explanations.json`:

```jsonc
{
  "version": 1, "model": "wind", "generatedBy": "…/explain.py",
  "detectors": { "<detectorId>": { "id", "name", "version", "archetype", "appliesTo", "summary",
                                   "pipeline": [{ "title", "text" }], "definition": { … },
                                   "run": { "evaluated": 19, "fired": [{ "assetId", "label", "at" }], "date" } } },
  "items": { "<attentionItemId>": {
    "detectorId", "detectedAt": "10:00",
    "conclusion": { "label": "Most likely cause|Cause|What's needed", "text", "confidence": "high|medium|low|n/a", "confidenceText" },
    "rootCauseAssetId": "…",                    // optional: when the cause is a different asset
    "chart": <chart>,                            // "What we see"
    "checks": [{ "id", "label", "role": "required|supporting", "status": "match|nomatch|pending",
                 "value", "why", "spark": { "values", "y", "band"?, "threshold"?, "highlight"?, "window"? } }],
    "references": [{ "id", "kind": "textbook|early|lookalike|variant", "tag", "title", "description",
                     "verdict": { "kind": "match|partial|nomatch", "text" }, "notes": [], "charts": [<chart with x>] }],
    "ruledOut": [{ "cause", "verdict": "ruled out|unlikely|not yet checked", "reason", "chart"? }],
    "excluded": "…" | null,                     // assets left out of the comparison, and why
    "confidence": { "level", "because", "notHigherBecause"?, "raiseIf"?, "lowerIf"?, "confirmedBy"? },
    "action": { "text", "workItemIds": [] },
    "model"?: { "target", "formula", "fittedOn" }, "impact"?: "…", "grouped"?: []
  } }
}
```

A `<chart>` is `{ unit, y: [lo, hi], decimals, series: [{ id, label,
style, values }], title?, caption?, band?: { label, lo, hi }, shadeGap?:
[idA, idB], thresholds?: [{ value, label }], markers?: [{ time, label }],
window?: [from, to], x?: { unit: "h"|"min", values } }`. Without `x`, the
axis is the pack timeline. Series `style` is one of `primary` (the asset
being explained), `expected` (what it should read, dashed), `reference`,
`secondary` or `peer` (thin comparison lines). The UI picks the colours.

### 14.4 Reference examples

Two or three per explanation, with the live asset overlaid from its onset:

- **textbook:** the fully developed failure;
- **early** (or **variant**): what it looks like while there is still time,
  or the same symptom from a sibling cause;
- **look-alike:** something that resembles it but isn't, with the
  reason it doesn't match. At least one per explanation. It's where
  operators learn the most.

Reference curves are synthetic, seeded with `build.Rng` so they're
reproducible, and shaped from the RESEARCH.md failure physics. Their
verdicts are written by hand, as teaching content, and aren't computed.

### 14.5 Confidence

Set by the detector's rule, not by hand:

- `low`: required checks only;
- `medium`: at least one independent supporting check;
- `high`: confirmed, by recovery after acting on the cause, or by an
  inspection.

An open item that nobody has inspected rarely deserves `high`. The runner
warns when the computed level differs from the attention item's
`confidenceLevel`.

### 14.6 Checks before handing back

- `python3 ModelAndData/industries/<model>/explain.py`: every attention
  item explained (exit 1 otherwise), and the run report lists where each
  detector fired. An extra detection is either covered by an item (icing
  on several turbines of one string, grouped via `Detector.group`) or
  listed in SCENARIOS.md with a reason.
- `python3 ModelAndData/industries/<model>/robustness.py 10`: reruns the
  generator with 10 other seeds and runs the detectors on each copy. Every
  item should be found every time, with no extra detections. This only
  varies noise, not the size or timing of the faults, so also note each
  detector's detection floor (the smallest fault it catches) in
  SCENARIOS.md.
- The validator checks the file (§8): item and detector references resolve,
  every required check matches, series lengths fit their axis, times are
  on the grid, and work items exist.

### 14.7 Registering and showing it

List the file under the pack's `"files"` block in `models.json`:

```json
"files": { "explanations": "explanations.json" }
```

It's an optional role, so packs without detectors leave it out (and the
browser never asks for a file that isn't there). The validator errors if
the file is listed but missing, and warns if it exists but isn't listed.
In the app, Investigate's AI tab shows `ExplanationView` for any attention
item that has an explanation, and the plain interpretation otherwise.

### 14.8 Limits to state plainly

These are **reference detectors**. Their thresholds come from the research
and were checked against simulated data, so they are a starting point to
tune on a customer's own history, not a validated product. Say so in
RESEARCH.md or SCENARIOS.md, together with each detector's detection
floor.

