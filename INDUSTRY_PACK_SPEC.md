# Industry Pack Spec — adding a new simulated industry to Aetherium

Read this before generating a new industry model (like `refinery`,
`water`, `wastewater`). It's the full requirements list: what to research,
what to design, what files to produce, the exact rules they follow, and
how to check the result. Read `PROJECT_CONTEXT.md` first for the app itself.

**How Amy will use this:** "Add a new industry: `<industry>`. Follow
`INDUSTRY_PACK_SPEC.md`." That request plus this file should be enough to
do the whole job. The only things to ask Amy up front are listed in §0.

Everything here comes from the three existing packs in `public/data/` and
the code that reads them in `src/OperatorWorkspace.jsx` (functions
`getDataFilesForModel`, `assignModelData`, `resolveWaterAssetProperties`,
`waterAssetDataIdTo*`, `attentionAssetToAssetEntry`,
`getPropertySeriesForSource`). If this spec and the code ever disagree,
the code wins. Fix this file when that happens.

---

## 0. Before starting — ask Amy (one batch)

1. **Which industry, and how specific?** (for example "power generation",
   "combined-cycle gas plant", "pharma tablet line").
2. **Plant name(s).** Fictional names, like Aurelia, Ferrum, Meridian and
   Confluence. The first 3 letters of each plant id become an id prefix,
   so they must be unique within the model.
3. **Anything the demo audience cares about?** (a customer segment, a
   failure mode they'll recognize, a KPI they'll look for).
4. **Is Excel output wanted too?** The default is: the generator script is
   the source of truth, and it writes JSON only.

If Amy isn't around to answer, pick sensible defaults, write them at the
top of `RESEARCH.md`, and carry on.

---

## 1. Deliverables checklist

| # | Deliverable | Where |
|---|---|---|
| 1 | Research brief (process, hierarchy, KPIs, failure modes, sources) | `ModelAndData/industries/<model>/RESEARCH.md` |
| 2 | Scenario sheet (each scenario's story, timeline and data footprint) | `ModelAndData/industries/<model>/SCENARIOS.md` |
| 3 | Deterministic generator script (fixed seed, rerunnable) | `ModelAndData/industries/<model>/generate.py` |
| 4 | The 20 runtime JSON files (§6) | `public/data/<model>/` |
| 5 | A passing run of the validator (§8) | `ModelAndData/tools/validate_industry_pack.py <model>` |
| 6 | App wiring (§9): small code edits so the model shows up in the switcher | `src/App.js`, `src/OperatorWorkspace.jsx` |
| 7 | Browser check: switch to the model, then click through Configurator → Types/Assets and Operator → Attention/Assets/Investigate, with screenshots | Claude's sandbox (per `PROJECT_CONTEXT.md`) |

`<model>` is a short lowercase slug with no spaces (for example `power`,
`pharma`). It is the folder name, the model-switcher id, and the key used
by `nowSelectionStorage`.

Commit the generator. The water and wastewater generators were never
saved, so those packs can't be regenerated. Don't repeat that.

---

## 2. Phase 1 — Research (RESEARCH.md)

Research with web search before designing anything. Aim for about 75%
realism and 25% demo clarity (the target set during the ChatGPT
design sessions in `ModelAndData/ChatGPT_2026082*.txt`): real terms, real
units, plausible magnitudes and real failure physics, simplified wherever
realism would make a demo hard to follow.

RESEARCH.md must cover:

1. **Process overview.** What the plant makes or does, and the main flow
   from input to output in 5–6 steps. These steps become the **stages**.
2. **Parallel units.** What the industry repeats in parallel (treatment
   trains, production lines, generating units, packaging lines). These
   become the **trains**. Justify having 6 of them, or explain the
   deviation.
3. **Equipment per step.** The 2–3 pieces of equipment an operator would
   name at each step (pumps, tanks, basins, mixers, screens, blowers,
   compressors, heat exchangers, fillers…). These become the **equipment**.
4. **KPIs and properties.** For each stage type and each equipment type:
   what's measured, in what unit, typical normal range, and which 1–2 of
   those numbers an operator watches most. Cite sources.
5. **Industry meaning of the universal KPIs.** Every stage carries the
   same 8 universal properties (§5.4). Write down what each one means for
   this industry: the throughput unit, what "scrap" or loss means, what
   WIP or holdup means, and what the target rate is.
6. **Failure modes.** At least 15 real, documented failure or abnormal
   modes, each with: the asset involved, the physical cause, the first
   measurable symptom, how it spreads downstream, how operators confirm
   it, the usual fix, and a typical timescale (minutes, hours or days).
   Cite sources: trade and regulator documents, OEM notes, operator
   training material, incident reports.
7. **Normal-operation context.** Operating modes and products or grades
   used in this industry (feeds `operating-context.json`), and typical
   routine work (sampling, rounds, inspections, handovers, permits).
8. **Sources.** A list of links.

---

## 3. Phase 2 — Model design

### 3.1 Hierarchy shape (fixed)

New packs use the **4-level shape** that water and wastewater use. The
refinery's 3-level shape is hardcoded in `src/assetData.js` and can't be
reused.

| `assetLevel` (exact string) | Meaning | Count per model | Existing examples |
|---|---|---|---|
| `plant` | Site | 1 (2 is allowed but untested on this path) | Meridian, Confluence |
| `train` | A parallel process unit | 6 per plant | T01…T06 |
| `stage` | A process step within a train. **This is the "station" level: it carries the rich telemetry.** | 5–6 per train (30–36 total) | Intake, Coagulation, Aeration… |
| `equipment` | Physical equipment within a stage | 2–3 per stage (80–100 total) | Raw Water Pump, Blower, Filter Bed |

The `assetLevel` strings are **not** negotiable, because the resolver
matches on them. Industry wording goes in `name`. For example, a power
plant's "units" are still `assetLevel: 'train'`, named `U01`…`U06`.

Every train contains the same stage types in the same order, and every
stage type has the same equipment types across trains. (Variation between
trains shows up in the data, not the structure.)

### 3.2 ID and naming rules (load-bearing — the app breaks if these are wrong)

Several different id formats refer to the same asset, and the app
converts between them with string rules. Follow these exactly. Examples
below use a plant named "Halcyon" with trains named `U01`.

| Thing | Rule | Example |
|---|---|---|
| Plant `id` | `UPPER(name)`, no spaces | `HALCYON` |
| Plant prefix `PFX` | first 3 chars of plant id | `HAL` |
| Train `name` | short code, no spaces, zero-padded number | `U01` |
| Train `id` | `PLANT_ID + '_' + train.name` | `HALCYON_U01` |
| Stage `name` | Title Case display name | `Steam Turbine` |
| Stage `assetType` | `slug(name)`: lowercase, spaces → `_` | `steam_turbine` |
| Stage `id` | `TRAIN_ID + '_' + UPPER(name) with spaces → '_'` | `HALCYON_U01_STEAM_TURBINE` |
| Equipment `name` | Title Case | `Lube Oil Pump` |
| Equipment `assetType` | `slug(name)` | `lube_oil_pump` |
| Equipment `id` | `STAGE_ID + '_' + UPPER(name) with spaces removed` | `HALCYON_U01_STEAM_TURBINE_LUBEOILPUMP` |
| **Station id** (keys in stage telemetry and metrics files) | `PFX + '_' + train.name + '_' + UPPER(assetType with '_' removed)` | `HAL_U01_STEAMTURBINE` |
| **Line id** (keys in line files) | `PLANT_ID + '_' + PFX + '_' + train.name` | `HALCYON_HAL_U01` |
| Line label | `plant.name + ' · ' + train.name` (the `·` is U+00B7 with spaces) | `Halcyon · U01` |
| Stage label (attention `asset`) | `plant.name + ' · ' + train.name + ' · ' + stage.name` | `Halcyon · U01 · Steam Turbine` |

Why these matter:

- `attentionAssetToAssetEntry` turns a stage label into an id by
  uppercasing each part and replacing spaces with `_`, then looks it up. So
  the stage id must be exactly `UPPER(label parts joined by _)`.
- `waterAssetDataIdToStageId` builds the station id from `PFX`,
  `train.name` and the stage's `assetType` with underscores removed.
- `waterAssetDataIdToTrainId` builds the line id the same way.
- Equipment ids are used directly as keys in the equipment files, with no
  conversion.
- The types list uses `TYPE_<assetLevel>_<assetType>`. Keep each
  `assetType` unique within its level. An equipment type may appear in
  several stages (for example `sludge_collector`), and it's then one type
  with many instances.

### 3.3 Property keys

- Use `snake_case` and put the **unit at the end** when there is one:
  `bearing_temp_c`, `discharge_pressure_psi`, `dosing_flow_rate_gpm`,
  `turbidity_ntu`, `level_pct`. Unitless indices end in `_index` or
  `_score`.
- **Metadata is global to the model, keyed by property name alone.** One
  label, one category, one tier and one range per key. So:
  - Reuse a key across equipment types only when it means the same thing
    and has the same normal range (every pump's `vibration_mms`).
  - When a similar measurement has a very different magnitude, give it a
    **different key**. Existing example: small dosing pumps use
    `motor_current_a` (about 3–5 A) while large process pumps use
    `process_motor_current_a`, so each gets its own gauge range.
- Reusable **equipment property kits** keep things consistent. From
  water and wastewater:
  - Centrifugal process pump: `flow_rate_gpm`, `discharge_pressure_psi`,
    `process_motor_current_a`, `vibration_mms`, `bearing_temp_c`
  - Metering or dosing pump: `dosing_flow_rate_gpm`,
    `discharge_pressure_psi`, `motor_current_a`, `vibration_mms`,
    `bearing_temp_c`
  - Storage tank: `level_pct`, `consumption_rate`, `temperature_c`
  - Basin or vessel: `level_pct`, `residence_time_min`
  - Screen: `differential_pressure_psi`, `rake_motor_torque_pct`,
    `cleaning_cycles_per_hr`
  - Mixer: `motor_current_a`, `<x>_speed_rpm`, `torque_pct`
  - Collector or skimmer: `motor_current_a`, `travel_speed_pct`,
    `cycle_time_min`
  - Blower: `air_flow_scfm`, `blower_discharge_pressure_psi`,
    `discharge_temp_c`, `vibration_mms`

  Reuse these keys when the new industry has the same kind of equipment.
  Add new kits (compressor, heat exchanger, turbine, conveyor, filler…)
  when it doesn't.
- **Stage "typed" properties:** 4–6 per stage type, specific to that
  process step (for example `coagulant_dose_mg_l`,
  `sludge_blanket_level_pct`). Don't repeat the 8 universal properties
  here.
- **Equipment properties:** 2–5 per equipment type.
- Aim for about 40–55 distinct stage and equipment property keys. Adding
  the 19 fixed rollup keys, that's about 60–70 metadata entries in total.

### 3.4 Property metadata

For **every** key that appears in any stage typed set, equipment set, line
rollup or plant rollup:

- **Label.** Short, human-readable name with no unit (units live in the
  key). "Raw Water Turbidity", not "Raw Water Turbidity (NTU)".
- **Category.** Exactly one of `Flow / WIP`, `Events / Losses`,
  `Stability`, `Quality`, `Derived Metric`, `Condition` (this list is
  `HMI_CATEGORY_ORDER`). Condition is for equipment-health signals
  (vibration, temperature, current, pressure drop). Quality is for product
  or effluent quality. Stability is for control or oscillation signals.
- **Tier.** `P1` (always shown), `P2`, or `P3` (shown only at "max").
  Existing packs are roughly 35% P1, 45% P2, 20% P3. The 1–2 numbers an
  operator watches most per stage or equipment type are P1.
- **Range.** `[min, max]` for the gauge. Normal operation should sit in
  the middle 30–70% of the range, and failure excursions should still fit
  inside it. **Every** numeric stage or equipment key needs a range.
  (Existing packs are missing one for `residence_time_min`. Don't copy
  that.)

Labels, categories and tiers must also cover the line and plant rollup
keys (§5.5). Ranges for rollup keys are optional.

### 3.5 Relationships (`asset-relationships.json`)

Schema: `{ sourceAssetId, targetAssetId, relationshipType, label, layer }`.

- Edges are **equipment → equipment** within one train. No edges cross
  trains, and there are no stage-level or train-level edges.
- `relationshipType` is `feeds_into` for every existing edge. Add a new
  type only if Amy agrees it's needed.
- `label` is `null`, except on edges that need explaining (such as
  "return activated sludge" or "periodic cleaning cycle, reverse flow").
- `layer` is required. Always include `process_flow` (the main flow
  from the first stage to the last). Add 1–2 industry-specific layers
  where they exist, for example `chemical_dosing`, `air_flow`,
  `backwash`, or new ones like `steam`, `cooling_water`, `lube_oil`,
  `power`. The same asset can receive edges from several layers.
- Real cycles are fine and wanted when the process has them (such as
  wastewater's return sludge).
- Equipment that acts on its own vessel and passes nothing onward (mixers,
  collectors, skimmers) may have no edge at all. Write down which ones and
  why in RESEARCH.md.
- The same edge pattern repeats in every train. Expect about 60–75 edges
  in total.
- Write the same content to both `asset-relationships.json` (what the
  loader reads) and `asset-relationships-<model>.json` (a copy kept to
  match the existing packs).

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
| 07 | Ghost signal | Symptom shows downstream, cause is upstream | Quality problem appears at a later stage |
| 08 | Throughput illusion | Headline rate hides losses | WIP or micro-stops ↑, rate looks fine |
| 09 | Cascade failure | Upstream fault spreads downstream | Upstream interruption, then downstream disturbances |
| 10 | Overcorrection loop | Manual and automatic corrections amplify each other | Oscillation growing |
| 11 | Hard block | Physical obstruction or trip | Flow → 0, holdup rises fast |
| 12 | Recurring micro-events | Small repeated interruptions add up | Event frequency above normal |
| 13 | Quality drift | Input or process shift heading toward a spec limit | Quality falling while throughput stays healthy |
| 14 | Plan or compliance at risk | Healthy equipment, a deadline or prerequisite at risk | Time needed is greater than time left |

**Coverage requirement:** at least **8 attention items**, covering at
least 8 different archetypes, and including at least one each of 05
(degradation), 06 (instrument versus process), 07 (upstream cause) and 11
or 09 (acute event). Archetype 01 never gets an attention item. Spread
the items across at least 5 different trains and at least 4 different
stage types.

Include a mix of outcomes as of "now":

- about 50–60% **resolved** (`attentionState: 'watch'`,
  `outcomeStatus: 'resolved'`)
- 1–2 **recovering**
- 2–3 still **open** (`investigate` or `act`, with `outcomeStatus:
  'none'`)
- at least one `act` item and at least one `high` severity item

### 4.2 Shared timeline (fixed across all models)

- Shift window: **08:00 to 14:05** on **2026-08-28**, a 5-minute grid,
  **74 points** (`08:00, 08:05 … 14:05`).
- **"Now" is 2026-08-28 14:05.** This is hardcoded in the app
  (`WORK_NOW_REFERENCE`, `NOW_REFERENCE_MIN`).
- Every scenario's evidence window must sit inside 08:00–14:05, with
  `evidencePoints` times **on the 5-minute grid**. (The time scrubber and
  the evidence tables both line up against this grid.)
- A resolved scenario's `sinceMinutes` = minutes from its resolution time
  to 14:05. An open scenario's `sinceMinutes` = minutes from its start to
  14:05. The `since` text must agree: `"Resolved 2h 35m ago"` or
  `"5h 35m ago"` or `"55m ago"`.
- At least one item with `sinceMinutes ≤ 30` makes the "new" dot on the
  Attention icon light up (`NEW_ATTENTION_THRESHOLD_MINUTES = 30`).

### 4.3 What SCENARIOS.md records per scenario

id, archetype #, stage label, the equipment it's rooted in, the primary
property (the one in `evidencePoints` and the stage sparkline), secondary
properties and how each one responds, start, peak, intervention and
recovery times, the downstream stages affected and their lag,
the ruled-out alternatives, the related work item(s), and a research
citation for why it's realistic. The generator reads the same numbers
(keep them as a table or dict at the top of `generate.py`), so the story
and the data can't drift apart.

---

## 5. Phase 4 — Generating telemetry

### 5.1 Baseline (normal) behaviour

- Every series (stage universal, stage typed, equipment, line and plant)
  has **74 points** on the shared grid.
- Model normal operation as a **slowly drifting AR(1) process around a
  per-asset setpoint**, not white noise. The existing data has lag-1
  autocorrelation of about 0.8–0.95. Typical coefficient of variation:
  about 0.2–2% for tightly controlled values (pH, availability,
  throughput), about 5–15% for loosely controlled ones (turbidity, WIP,
  differential pressure). Queue-like values can hit 0.
- Give each train a slightly different setpoint or efficiency (about
  ±1–3%) so the trains aren't identical and there's a real best and worst
  train.
- **Stay within physics:** percentages stay within 0–100 (the existing
  packs occasionally show `performance` and `availability` above 100 —
  don't copy that), counts are ≥ 0, and values stay inside their
  `property-ranges` entry.
- Round stored values to 3 decimals, or 2 for percentages. Use a fixed
  random seed.

### 5.2 Injecting a scenario (its footprint in the data)

For each attention item, the generator must write the story into the
telemetry, not just into the narrative text:

1. **Primary property** at the affected stage: follows the
   `evidencePoints` values at their exact times (with a little noise in
   between), shaped by the archetype (ramp, step, oscillation, spike and
   recovery…).
2. **Root-cause equipment:** the equipment's own condition signals change
   in the physically right direction, **starting before or with** the
   stage symptom. (Example from water: the coagulant under-dose shows
   discharge pressure falling on the metering pump.)
3. **Downstream effect:** at least one downstream stage in the same
   train responds after a realistic lag (example: settled-water turbidity
   rises about 40 minutes after the coagulant dose drops). Archetype 06
   (instrument fault) is the exception: nothing downstream or nearby
   confirms it, and that absence is the point.
4. **Universal KPIs** at the affected stage (performance, quality_factor,
   throughput, wip…) dip or rise by a believable amount during the
   episode and recover afterward if it was resolved.
5. **Recovery** after the intervention time, with realistic lag. Open
   items are still abnormal at 14:05.
6. Train-level and plant-level rollups are recomputed from the stage data
   (§5.5), so the incident shows up there too.

`evidence` (the number array) = the numeric values of `evidencePoints`,
in order. For non-numeric evidence (event counts, task states), use small
integer codes as the existing packs do.

### 5.3 The "current value" rule

For every asset, the **snapshot value equals the last point (14:05) of
its own series.** The Investigate time scrubber depends on this.

- `station-full-properties[stationId][k]` equals the last value of
  `station-telemetry.stations[stationId].typed[k]`, exactly.
- `equipment-metrics[eqId][k]` equals the last value of
  `equipment-telemetry.equipment[eqId][k]`, exactly.
- `line-rollups[lineId][k]` equals the last value of
  `line-telemetry.lines[lineId][k]` (for numeric keys that have a series).
- `plant-rollups[plantId][k]` equals the last value of
  `plant-telemetry.refineries[plantId][k]`.
- In `station-metrics`, `throughput`, `oee`, `wip`, `queueLength` and
  `scrapRate` equal the last universal value, rounded to display
  precision (within 0.05).
- `station-sparklines[stationId].values` is identical to that stage's full
  typed series for the named property.

### 5.4 Universal stage properties (fixed key set)

Every stage's `universal` block has exactly these 8 keys: `performance`,
`availability`, `quality_factor`, `throughput`, `oee`, `wip`,
`queue_length`, `scrap_rate`.

- `oee = availability × performance × quality_factor / 10,000`, per point.
- `throughput` is in the industry's natural rate unit per train (for
  example MGD, t/h, units/min, MW). `targetRate` is the design rate.
- `scrap_rate` is the % of throughput lost or off-spec. `wip` is holdup
  or inventory in the stage. `queue_length` is backlog. Record the
  industry meaning of each in RESEARCH.md.

### 5.5 Rollup formulas (match the existing packs)

Train (line), per time point, over the train's stages:

| Key | Formula |
|---|---|
| `line_throughput` | mean of stage `throughput` |
| `line_target_rate` | the train's design rate (constant) |
| `line_oee`, `line_availability`, `line_quality_factor` | mean of the stage values |
| `total_wip` | sum of stage `wip` |
| `system_health_index` | = `line_oee` |
| `flow_efficiency` | = `line_availability` |
| `instability_index` | a variability measure of the train's stages (0–100 scale; the existing packs sit around 2–8 when normal). Document the formula in `generate.py` |
| `bottleneck_station` (snapshot only) | the `stationType` (underscores kept) of the stage with the lowest `throughput` at 14:05 |

Plant, per time point, over its trains:

| Key | Formula |
|---|---|
| `plant_throughput`, `plant_target_rate` | sum over trains |
| `plant_oee`, `plant_availability`, `plant_quality_factor` | mean over trains |
| `plant_health_index` | = `plant_oee` |
| `plant_instability_index` | max of the trains' `instability_index` |
| `best_train`, `worst_train` (snapshot only) | line ids with the highest and lowest `line_oee` at 14:05 |

---

## 6. File contracts — the 20 files in `public/data/<model>/`

The names in the left column are the global variables `assignModelData`
fills. Paths are fixed by the loader's file list (§9), so file names for
new packs can be cleaner than the legacy `water-*` ones.

| Loader name | File (new packs) | Shape |
|---|---|---|
| `WATER_ASSET_DATA` | `asset-data.json` | `[{ id, parentId, name, assetType, assetLevel }]`, ordered as a depth-first walk (plant, train, stage, its equipment, next stage…) |
| `ASSET_RELATIONSHIPS` | `asset-relationships.json` (+ the `-<model>` copy) | see §3.5 |
| `STATION_TELEMETRY` | `station-telemetry.json` | `{ timestamps:[74 "HH:MM"], stations:{ [stationId]:{ universal:{8 keys:[74]}, typed:{k:[74]} } } }` |
| `STATION_FULL_PROPERTIES` | `station-full-properties.json` | `{ [stationId]: { typedKey: value } }`, the same keys as `typed` |
| `STATION_METRICS` | `station-metrics.json` | `{ [stationId]: { stationType, isReal:false, plant, throughput, targetRate, oee, wip, queueLength, scrapRate, highlights:[{label:typedKey, value}] ×2 } }`. `stationType` = UPPER(assetType) with underscores **kept** (`PRIMARY_CLARIFIER`); `plant` = plant.name |
| `STATION_SPARKLINES` | `station-sparklines.json` | `{ [stationId]: { property: typedKey, values:[74] } }`, one entry for each stage that has an attention item |
| `EQUIPMENT_TELEMETRY` | `equipment-telemetry.json` | `{ timestamps:[74], equipment:{ [equipmentId]:{ k:[74] } } }` |
| `EQUIPMENT_METRICS` | `equipment-metrics.json` | `{ [equipmentId]: { k: value } }`, for **every** equipment asset |
| `LINE_TELEMETRY` | `line-telemetry.json` | `{ timestamps:[74], lines:{ [lineId]:{ 9 line keys:[74] } } }` |
| `LINE_ROLLUPS` | `line-rollups.json` | `{ [lineId]: { 9 line keys + bottleneck_station } }` |
| `REFINERY_TELEMETRY` | `plant-telemetry.json` | `{ timestamps:[74], refineries:{ [plantId]:{ 7 plant keys:[74] } } }`. **The top-level key really is `refineries`**, because `getPropertySeriesForSource` reads that name |
| `REFINERY_ROLLUPS` | `plant-rollups.json` | `{ [plantId]: { 7 plant keys + best_train + worst_train } }` |
| `LINE_STATUS` | `line-status.json` | `[{ id: lineId, label: lineLabel, state, statusSinceMinutes }]`, one per train. `state` is one of `running`, `attention`, `changeover`, `down`. A train with an open attention item is `attention`, with `statusSinceMinutes` = the minutes since its oldest open item started |
| `OPERATING_CONTEXT_BY_LINE` | `operating-context.json` | `{ [lineId]: { mode, product } }`. `mode` is one of `STEADY`, `CHANGEOVER`, `RAMP_UP`, `RAMP_DOWN`, `STOPPED`, `MAINTENANCE`, `CONTROLLED_HOLD`. `product` = the industry's product or grade name |
| `PROPERTY_LABELS` | `property-labels.json` | `{ key: "Label" }` |
| `PROPERTY_CATEGORIES` | `property-categories.json` | `{ key: category }` (§3.4) |
| `PROPERTY_TIERS` | `property-tiers.json` | `{ key: "P1"\|"P2"\|"P3" }` |
| `PROPERTY_RANGES` | `property-ranges.json` | `{ key: [min, max] }` |
| `ATTENTION_ITEMS` | `attention-items.json` | see below |
| `INITIAL_WORK_ITEMS` | `work-items.json` | see below |

**Attention item:**

```jsonc
{
  "id": "HSIT01",                 // unique across ALL models: pick a new prefix (existing: SIT, WSIT)
  "severity": "high|medium|low",
  "asset": "Halcyon · U02 · Steam Turbine",   // stage label (3 parts); 2-part train label only for train-wide items
  "line": "Halcyon · U02",                    // train label, must match line-status label
  "signal": "One-line headline, operator voice",
  "aiInterpretation": "One or two sentences: what the AI thinks is going on",
  "since": "Resolved 2h 35m ago",
  "sinceMinutes": 155,
  "attentionState": "urgent|act|investigate|watch",
  "detail": {
    "signal": "…specific numbers, times…",
    "observed": "raw facts", "derived": "computed or correlated facts", "inferred": "hypothesis",
    "recommendation": "what to do",
    "evidence": [18.1, 17.6, …],              // numbers from evidencePoints, in order
    "evidencePoints": [{ "time": "09:40", "value": "18.1 mg/L", "label": "Baseline" }, …],  // 5–8 points, on the 5-min grid, labels on the key moments and "" elsewhere
    "relatedOccurrences": [{ "date": "2026-07-14", "summary": "…" }],   // 0–2 past occurrences; [] if none
    "whatChangedSummary": "one sentence",
    "whatChanged": [{ "time": "11:32", "source": "Operator Action|Maintenance|Field Check|Event|Alarm|Setpoint Change|Quality Event|…", "description": "…", "related": true }],
    "confidence": "Confirmed by inspection", "confidenceLevel": "high|medium|low|n/a",
    "risk": "Low — caught before …", "riskLevel": "high|medium|low|none",
    "expectedOutcome": "…", "outcomeStatus": "resolved|recovering|none"
  }
}
```

For items still open at 14:05, don't put the confirmed root cause in the
text. The AI shouldn't know the answer before its own diagnosis gets
there (a design decision from the Aug 27 sessions).

**Work item:**

```jsonc
{
  "id": "wk-h01", "text": "Short task title", "description": "…",
  "assetLabel": "Halcyon · U02",        // plant name, train label or stage label, or null
  "workType": "SAMPLE|INSPECTION|HUDDLE|MAINTENANCE|INSTRUMENT_CHECK|DOCUMENTATION|QUALITY_CHECK|PROCEDURE|CHANGEOVER|MATERIAL_STAGE|QUALITY_RELEASE",
  "priority": "urgent|important|routine",
  "sourceType": "planned|situation", "sourceLabel": "From: Steam turbine vibration climbing" /* display text, shown after the task type; null for planned */, "source": "operator|ai",
  "assignedRole": "Operator|Field Operator|Maintenance|Quality|Materials",
  "plannedStart": "2026-08-28T08:15:00", "dueAt": "2026-08-28T08:15:00",
  "estimatedDurationMinutes": 15,
  "done": true, "completedAt": "2026-08-28T08:22:00",   // null when not done
  "createdAt": "2026-08-28T08:00:00"
}
```

Aim for 9–14 work items: about half planned routine work from
RESEARCH.md §7, and half created from situations (`source: "ai"`,
`sourceType: "situation"`), each tied to an attention item by being on
the same asset and by `sourceLabel: "From: <that item's situation>"`.
(This is the same format the app uses when an operator creates a task from
Investigate.) Leave 2–4 not done, with at least one
due after 14:05. ISO times are local with no `Z`.

---

## 7. Size targets (keep the app fast and in line with existing packs)

| Item | Target |
|---|---|
| Stages | 30–36 |
| Equipment | 80–100 |
| Relationship edges | 60–75 |
| Distinct stage and equipment property keys | 40–55 |
| Attention items | 8–12 |
| Work items | 9–14 |
| Largest single file | under 700 KB |

---

## 8. Validation (required before handing anything back)

Run:

```
python3 ModelAndData/tools/validate_industry_pack.py <model>
```

It checks, among other things: the hierarchy shape and every §3.2 id
rule; full cross-file key coverage; 74-point series; the §5.3 "current
value" rule; the OEE formula; the rollup formulas; metadata coverage and
allowed values; the relationship rules; attention and work item schemas;
the timeline, grid and `sinceMinutes` consistency; and the scenario
coverage minimums. Errors must be zero. Warnings need a reason, written
down in SCENARIOS.md.

Then do the browser check from `PROJECT_CONTEXT.md` with the new model
selected, and actually look at the screenshots:

- Configurator: the Types and Assets tabs list the new types and assets,
  and property previews show gauges with ranges.
- Operator: the Attention list, Investigate (Trend, Assets and the time
  scrubber moving real values), and the Assets view with a Diagram of the
  relationships.

---

## 9. Wiring the model into the app (current code, Sept 2026)

Today a new model needs small code edits. **Coordinate before editing
`OperatorWorkspace.jsx`**, because other work may be happening in the same
file at the same time.

1. `src/App.js`: add `{ id: '<model>', label: '<Label>' }` to the model
   list (search for `{ id: 'wastewater', label: 'Wastewater' }`).
2. `src/OperatorWorkspace.jsx`:
   - add a `<MODEL>_DATA_FILES` array (copy `WASTEWATER_DATA_FILES`, with
     paths and names from §6)
   - add a branch to `getDataFilesForModel`
   - add the model to the two `water || wastewater` checks: the loader's
     `CURRENT_ASSET_DATA` assignment, and `resolveAssetProperties`

**Recommended one-time refactor** (do it once and later industries need
no code at all): replace those checks with a single list of 4-level
models, or better, a `public/data/models.json` manifest
(`[{ id, label, shape: "4-level", files: {...} }]`) read by both App.js and
the loader.

**Known refinery-only UI.** These don't generalize yet, even for water or
wastewater. They're outside the data pack's scope, but worth telling Amy
about:

- the Issue Map grid (`AURELIA_LINES`, `FERRUM_LINES` and the station
  lists)
- `lineIdToAssetId` (Now-strip tile clicks)
- `attentionAssetToStationId`
- `STATION_TYPE_LABELS`, `HIGHLIGHT_FIELD_LABELS` and
  `SPARKLINE_PROPERTY_LABELS` (the Line Detail captions)

---

## 10. Known quirks in the existing packs — don't copy them

- `performance` and `availability` sometimes exceed 100 in water and
  wastewater.
- `residence_time_min` has no range entry in water or wastewater.
- `station-metrics` values are rounded snapshots, not exact last points
  (tolerated; new packs may round the same way).
- The variable and key names `REFINERY_ROLLUPS`, `REFINERY_TELEMETRY` and
  `refineries` are legacy names that now mean "plant level". Keep them for
  the loader; don't propagate the word "refinery" anywhere else.
- `water-asset-data.json` is also used for wastewater. New packs should
  use the clearer `asset-data.json`.
- **Line and plant series** were generated separately from the stage
  series. Only the 14:05 endpoint matches the rollup formulas (mid-shift,
  line OEE can be up to about 2 points off the stage mean). New packs must
  compute rollups at every point.
- In wastewater, `bottleneck_station` drops the underscore
  (`SECONDARYCLARIFIER`) while `stationType` keeps it.
- Some `evidencePoints` fall off the 5-minute grid (for example
  `09:41`), and two water work items still say "Meridian & Confluence"
  from when the two were one model.
- No generator scripts exist for the three current packs.

Running the validator on `water` or `wastewater` reports exactly these
quirks and nothing else. That's a useful reminder of what "legacy" means
here, and a check that the spec matches the real files.

---

## 11. Definition of done

- [ ] RESEARCH.md and SCENARIOS.md written, with sources
- [ ] `generate.py` committed, deterministic, and it regenerates every
      JSON file from scratch
- [ ] all 20 JSON files present; the validator shows 0 errors
- [ ] model wired into the app (§9), and it loads with no console errors
- [ ] screenshots reviewed for Configurator and Operator views
- [ ] handed to Amy as full files to drop in, with a short note on the
      scenarios and which archetypes they cover
