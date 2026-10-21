# Drinking-water treatment — scenario sheet (Meridian, 28 Aug 2026)

"Now" is **14:05**. The timeline is 08:00–14:05 at 5-minute steps (74
points). The seven attention items and nine work items are the original
hand-built pack's, unchanged in id, asset, text and timing. `generate.py`
writes each story into the telemetry from the scenario constants at its top;
evidence values are read back from the generated series. Numbers quoted in
an item's text are pinned into the series at the quoted times (a small
correction tapered over ±30 min, so the noise texture stays), which keeps
the text true for any noise seed.

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:05 |
|---|---|---|---|
| WSIT01 | 05 Component degradation (metering-pump diaphragm) | T02 · Coagulation (stage) | resolved |
| WSIT02 | 04 Accumulation (cause upstream: raw turbidity + desludge timer) | T04 · Sedimentation (stage) | resolved |
| WSIT03 | 03 Quiet drift (filter media fouling) | T01 · Filtration (stage) | **open**: investigate |
| WSIT04 | 06 Signal noise (turbidimeter) | T05 · Sedimentation (stage) | resolved |
| WSIT05 | 09 Cascade (storm shock propagating downstream) | T03 · Intake (stage) | resolved, high |
| WSIT06 | 12 Recurring micro-events (extra backwashes) | T06 · Filtration (stage) | **open**: investigate |
| WSIT07 | 14 Plan / compliance at risk (CT margin) | T02 · Disinfection (stage) | **recovering**: act |

- 7 items, 7 archetypes, all 6 trains, 5 stage types, all on non-leaf
  assets (stages have equipment children).
- Gaps inherited from the original pack (items could not change): no pure
  **07 ghost signal** item (WSIT02 has an upstream cause and WSIT01 shows
  downstream, but neither item sits on the downstream asset); all items on
  one level; none started within 30 minutes of now (see warnings below).
- **Archetype 01 (normal)** is everything else: every intake except T03's
  (and T04's small raw step), all rapid-mix, paddle, raw-pump and chlorine
  equipment, T05's filter apart from one routine backwash.
- **Archetype 02 (busy-but-normal)**: sampling, walkthrough, briefing,
  handoff (wk-w01–03, wk-w14).

## Scenarios

### WSIT01 — T02 coagulant dose drifts low: metering-pump diaphragm wear (05)

- **Asset:** `MERIDIAN_T02_COAGULATION`. **Primary:** `coagulant_dose_mg_l`.
  **Root cause asset:** `…_T02_COAGULATION_COAGULANTMETERINGPUMP` (edge
  `chemical_dosing`).
- **Root cause first (09:30):** pump discharge pressure falls up to 1.8 psi
  and `coagulant_pump_stability` up to 2.4 points by 11:30; pump vibration
  +0.35 mm/s. Pumped flow (`dosing_flow_rate_gpm`) falls ~15%.
- **Symptom:** dose 18.1 (09:40, pinned) → 17.4 (10:30) → 16.7 (10:55) →
  **15.4 at 11:15 and 11:30** (pinned; held near the bottom until the
  inspection). Recalibrated 11:38; 17.9 at 11:45, ~18.1 from 12:00.
- **Downstream (lag 2–4 steps):** floc formation 89 → 77, floc size 76 →
  66, jar-test deviation 3.7 → 6.9%, settled turbidity 2.2 → 3.0 NTU peaking
  11:30, coagulant consumption −15%. Filtered water flat (0.08 NTU).
  Train quality factor −0.15, health −0.3; both recover.
- **Times:** start 09:30, peak 11:15–11:30, fix 11:38, recovered 12:00;
  resolved 11:30 per the item. **Work:** wk-w04 (done 11:38).

### WSIT02 — T04 sludge blanket accumulates (04)

- **Asset:** `MERIDIAN_T04_SEDIMENTATION`. **Primary:**
  `sludge_blanket_level_pct`. **Causes:** `…_T04_INTAKE` raw turbidity +3 NTU
  (09:20–10:00, stays up) and `…_SLUDGECOLLECTOR` cycle time stretched +8.5
  min (10:00–12:05; timer not adjusted).
- **Symptom:** blanket **33.2% at 10:20 → 58.0% at 12:10** (both pinned,
  12:10 is the peak), roughly linear. Settled turbidity +0.4 NTU near the
  peak (blanket > 45% adds carryover).
- **Fix:** manual desludge 12:10–12:25 (collector speed +50%, current +30%;
  current also creeps up with the thicker blanket). Blanket 44.5% at 12:25,
  ~35% at 12:40, 33% by 13:00. Timer shortened after the 12:12 review: cycle
  time 2.5 min below its setpoint afterwards.
- **Work:** wk-w05 (done 12:12). Resolved 12:20.

### WSIT03 — T01 filter headloss climbing, run time shortening (03)

- **Asset:** `MERIDIAN_T01_FILTRATION`. **Primary:** `headloss_ft`.
- **Story:** headloss 2.45 (08:00) → **2.6 at 08:30 → 4.4 at 14:05**
  (pinned), ~0.32 ft/h, while the other filters rise 0.5–0.65 ft over the
  whole shift (~0.09 ft/h). Filter-bed ΔP follows (2.2 → 3.2 psi).
- **Secondary:** projected run time 48 → 30.6 h; backwash frequency
  3.5 → 5.5 /week; UFRV 9,560 → 6,130 gal/ft²; health −0.35.
- **What doesn't move:** filter effluent (0.07–0.10 NTU), T01 raw and
  settled turbidity. That absence is the item's argument for media fouling.
- **Times:** from shift start; **open** at 14:05. **Work:** wk-w06 (not
  done, due 15:00).

### WSIT04 — T05 settled-water turbidimeter erratic (06)

- **Asset:** `MERIDIAN_T05_SEDIMENTATION`. **Primary:**
  `settled_water_turbidity_ntu` (the reading).
- **Story:** true settled turbidity stays at 2.0 ± 0.1 NTU. The reading
  swings 09:40–10:30 through a fixed pattern (2.5, **1.8**, 3.4, 2.4, 3.9,
  **4.6**, 2.3, 3.6, 2.1, 3.0, 2.6) plus small jitter; 1.8 (09:45) and 4.6
  (10:05) are pinned as the window's min and max. Grab sample 10:20, sensor
  cleaned 10:32, true values from 10:35.
- **What doesn't move (the point):** T05 filter effluent, raw turbidity,
  blanket, dose, and the train quality factor (computed from the true
  value). Nothing related confirms it.
- **Work:** wk-w07 (done 10:32). Resolved 11:10.

### WSIT05 — T03 storm raw-water turbidity shock (09)

- **Asset:** `MERIDIAN_T03_INTAKE`. **Primary:** `raw_water_turbidity_ntu`.
- **Story:** **9.2 NTU at 10:30 → 68.1 at 12:00** (pinned; the series
  peak) → 11.2 at 12:40 → baseline by 13:10. Storm logged 10:52.
- **Upstream effects (no lag):** screen ΔP +0.7 psi, rake torque +18%,
  cleaning cycles +2.5/h, intake flow variability +1.6, raw pH −0.3.
- **Response:** dose × 1.28 from 11:50 (operator, 11:48), × 1.12 from 12:45,
  back to setpoint 13:15 (dose 18.4 → 23.9 → 18.4 mg/L).
- **Downstream (lagged):** settled turbidity 1.9 → 3.3 NTU at 11:45 then
  falling once the dose rises; blanket +5%; filtered 0.08 → 0.10 NTU (never
  near 0.3); chlorine demand 0.83 → 1.15 mg/L with the feed pump and
  hypochlorite use rising to hold residual; DBP risk up ~30%. Train
  instability 3 → 5.5, quality factor −0.3; all recover.
- **Work:** wk-w08 (done 12:58). Resolved 12:40.

### WSIT06 — T06 filter backwashing far more often than its cycle (12)

- **Asset:** `MERIDIAN_T06_FILTRATION`. **Primary:** `headloss_ft`
  (evidence are event codes: 1 = a backwash in that sample, as in the
  original pack).
- **Story:** normal slow rise to 3.4 ft until 11:00. Backwashes at **11:05,
  11:50, 12:40, 13:20, 14:00** (constants). Each resets headloss to 2.0 ft,
  after which it climbs ~2.3 ft/h (vs 0.09 normally) to 3.3–3.8 ft before
  the next.
- **Secondary:** backwash frequency 3.5 → 6.6 /week (rolling estimate,
  +0.65 per extra backwash, lagged); projected run time 48 → 25.6 h; UFRV
  9,540 → 5,010; filter-bed backwash cycles/day 1.2 → 2.1; backwash pump
  flow +12%, current +8%, pressure +6% in each backwash sample; a 0.035 NTU
  ripening spike after each backwash (max 0.12 NTU); train throughput −1.5%
  and flow efficiency −0.4 in each backwash sample, instability +0.8 decaying.
- **Look-alike elsewhere:** T05 does one routine end-of-run backwash at
  12:30 (headloss 5.4 → 1.7 ft, same pump and ripening footprint, no
  frequency change).
- **Times:** from 11:00; **open** at 14:05. No work item.

### WSIT07 — T02 contact basin baffle maintenance narrows CT margin (14)

- **Asset:** `MERIDIAN_T02_DISINFECTION`. **Primary:** `ct_value_actual`.
- **Story:** planned work from 13:00 takes basin volume out of service:
  contact basin level 94 → 74%, residence 31 → 26.5 min, contact time
  **35.0 → 29.0 min** (pinned at 13:00 and 14:05). Residual stays at
  ~1.22 mg/L (pinned at 14:05 to T02's setpoint, so "unchanged" holds).
  CT = residual × contact time × k falls ~155 → **128 at 14:05** against
  required **120.0** (pinned).
- **Recovery:** after 14:05 (item is `recovering`). Work: none.

## Old vs new evidence (seed 20260828)

| Item | Old | New |
|---|---|---|
| WSIT01 | 18.1 17.6 16.9 16.2 15.6 15.4 17.8 18 | 18.1 18.1 17.4 16.7 15.4 15.4 17.9 18.4 |
| WSIT02 | 33.2 38.6 44.1 49.8 55.2 58 44.3 35.1 | 33.2 39.0 44.4 49.8 55.9 58.0 44.5 35.7 |
| WSIT03 | 2.6 2.9 3.2 3.5 3.8 4 4.2 4.4 | 2.6 2.9 3.3 3.5 3.8 4.1 4.3 4.4 |
| WSIT04 | 2 1.9 3.4 4.6 2.1 2 1.9 2 | 1.9 2.0 3.5 4.6 2.0 2.0 2.0 2.0 |
| WSIT05 | 9.2 14.8 31.5 52.3 68.1 54.2 28.6 11.4 | 9.2 14.1 30.7 52.0 68.1 54.1 28.4 11.2 |
| WSIT06 | 1 1 1 1 1 | 1 1 1 1 1 |
| WSIT07 | 145 142 138 133 130 128 | 155 152 142 136 129 128 |

WSIT01's profile was reshaped so its notes hold ("Drift begins" at 10:30,
"Lowest point" at 11:15; the old data was already falling at 10:05 and
lowest at 11:30). WSIT07 starts higher because CT is now computed from
residual × contact time: 35 → 29 min at a constant residual is a 17% drop,
so reaching the quoted 128 means starting near 155.

## Detectors and explanations (spec §14)

`explain.py` runs seven detectors, one per failure mode, on every asset each
applies to, and writes `public/data/water/explanations.json`. Each one reads
only the runtime files through `detectors/pack.py` — never this sheet,
`generate.py`'s constants, or an attention item's own signal, evidence or
interpretation text. Meridian is the one pack where every unit is identical,
so "expected" is one of three things: the stage's **own level** earlier in
the shift (dose, blanket, headloss, contact time), **the same stage on the
other five trains**, or **the process physics** — dose against the jar-test
optimum for the raw water, CT = free chlorine residual × T₁₀, a mass balance
on the blanket (solids in against solids out). Cross-instrument agreement
does the rest: the settled-water turbidimeter is judged against the filter
it feeds, the metering pump against the dose it produces, a backwash against
the backwash pump's own flow.

| Item | Detector | Ran on | Fired on | Raised at | Root cause asset | Confidence |
|---|---|---|---|---|---|---|
| WSIT01 | `water.coagulant_delivery_loss` | 6 coagulation stages | T02 · Coagulation | 11:25 | T02 coagulant metering pump | high |
| WSIT02 | `water.sludge_blanket_rise` | 6 sedimentation stages | T04 · Sedimentation | 11:25 | T04 sludge collector | high |
| WSIT03 | `water.filter_media_fouling` | 6 filtration stages | T01 · Filtration | 10:00 | — (the bed itself) | medium |
| WSIT04 | `water.settled_turbidimeter_fault` | 6 sedimentation stages | T05 · Sedimentation | 09:55 | — (the instrument) | high |
| WSIT05 | `water.raw_turbidity_shock` | 6 intakes | T03 · Intake | 11:20 | — (the source water) | high |
| WSIT06 | `water.filter_backwash_cycling` | 6 filtration stages | T06 · Filtration | 12:45 | T06 filter bed | medium |
| WSIT07 | `water.ct_margin_loss` | 6 disinfection stages | T02 · Disinfection | 13:45 | T02 chlorine contact basin | high |

**No detector fired anywhere else**, so there are no extra detections to
explain. Every computed confidence matches the item's `confidenceLevel`.
Two detectors share the sedimentation stages (blanket and turbidimeter) and
two share the filtration stages (fouling and backwash cycling); each pair
stays disjoint, because the blanket detector needs a sustained rise above
45 % of basin depth that the level cannot explain, the turbidimeter detector
needs whole-NTU reversals that nothing downstream confirms, the fouling
detector needs a two-hour window with **no** backwash in it, and the cycling
detector needs at least three.

### What each one checks

- **`water.coagulant_delivery_loss`** (05). Expected dose = the stage's own
  first 90 minutes moved with raw turbidity to the power 0.2, the way the
  jar-test optimum moves. Required: the residual is more than 10 % short,
  held for 20 minutes, with raw turbidity inside ±40 % (so the target has
  not moved) **and** the metering pump's own delivered flow down >8 % and
  discharge pressure down >5 % — which is what separates a worn diaphragm
  from someone turning the setpoint down. Supporting: stroke stability, the
  bench jar test, settled turbidity one residence time later, floc
  formation, comparable trains, and the dose returning after the
  recalibration (which is what makes it `high`). The train comparison
  excludes T01, T03 and T04, whose own raw water moved more than ±40 % in
  the window, so their expected dose moved with it.
- **`water.sludge_blanket_rise`** (04). Required: the blanket rising faster
  than 8 % of basin depth per hour for 30 minutes, above the 45 % carryover
  level, with the basin water level able to account for less than 30 % of
  the rise (the blanket is a share of depth, so a falling level would read
  as a rising blanket), and every other basin gaining less than a third of
  what this one gained. Supporting — and this is the mass balance —
  solids **in** up (raw turbidity +42 %) against solids **out** down
  (desludge cycle time +68 %), plus collector current, carryover in the
  settled water, and the blanket falling 13 points within 15 minutes of the
  extra cycle, which is what makes it `high`.
- **`water.filter_media_fouling`** (03). Required: headloss rising faster
  than 0.20 ft/h over a two-hour window with no backwash in it (0.33 ft/h
  against 0.07 ft/h on the other five), as a creep rather than a step
  (largest 5-minute change 0.09 ft), with filtered water inside spec — so
  it is resistance, not breakthrough — and the settled water into it within
  ±25 % of the peer median, so it is not an upstream load. Supporting: the
  bed's own ΔP transmitter (+45 %), run length and UFRV. Stays `medium`
  because the bed inspection (wk-w06) is still open.
- **`water.settled_turbidimeter_fault`** (06). Required: at least four
  sample-to-sample jumps over 0.4 NTU inside an hour with at least three
  reversals, while the filter it feeds moves less than 0.03 NTU over the
  episode plus one residence time, raw turbidity and dose stay inside their
  bands, and the blanket stays put. The grab-sample value itself is only in
  the item text and is never read; the detector uses the reading's own level
  before and after, and reads the field-check work item and the maintenance
  log only for confidence.
- **`water.raw_turbidity_shock`** (09). Required: raw turbidity over 2× its
  own two-hour baseline, rising faster than 15 NTU/h, held for 15 minutes,
  **and** the screen on the same channel agreeing — differential pressure
  and rake torque both up more than 8 %, which is what rules out a
  turbidimeter fault. Supporting: cleaning cycles, raw pH, the other five
  intakes, the dose response, and the cascade itself — settled, filtered and
  chlorine demand each a stage behind the last, all inside their limits.
- **`water.filter_backwash_cycling`** (12). Washes are counted as headloss
  resets over 1.0 ft; required are three or more inside four hours, a mean
  gap under 90 minutes against this filter's own 168 ÷ backwash-frequency
  cycle (48 h), and every wash completing properly (headloss back to ~2.0 ft,
  effluent back under 0.15 NTU within 20 minutes) — so the finding is the
  count, not a failing wash. Supporting: the backwash pump confirming each
  reset from its own instruments, the washes happening at 3.3–3.8 ft against
  6 ft terminal (T05's one routine wash went at 5.4 ft), the 2.3 ft/h reload
  rate against 0.09 ft/h before 11:00, UFRV and run length, and the bed's own
  cycle counter. `medium`: the washes are certain, the reason for the short
  runs is not.
- **`water.ct_margin_loss`** (14). Required: the margin under 18 % of the
  required CT for 10 minutes, a straight-line projection of the last hour
  reaching the required CT within 90 minutes (17 minutes, as of now), the
  whole loss attributable to contact time (T₁₀ −16 %) with the residual
  unchanged (+1.4 %), and the required CT itself flat so the bar has not
  moved. That last pair is what keeps it off T03, whose CT also dips during
  the storm — but from chlorine demand, not from contact time. Supporting:
  basin level and residence time, flow, the feed pump, the other five
  trains' margins, and the maintenance record at 13:00, which is what makes
  it `high`.

**Robustness.** `robustness.py 10` regenerates the pack with ten other
seeds and runs the detectors on each copy. All seven items were found on all
ten, with no extra detections and the same confidence every time. Raise
times move a little with the noise: WSIT01 11:10–11:30, WSIT02 11:15–11:40,
WSIT07 13:30–13:55, and WSIT03, WSIT04, WSIT06 within one step.

**Detection floors.** Seeds only vary the noise, so the size of each fault
was scaled as well, in a temporary copy of `generate.py` (scenario anchors
and pins scaled by α around their baselines, three seeds per point):

| Item | Full size (α = 1) | Found 3/3 down to | 1/3 at | Never at |
|---|---|---|---|---|
| WSIT01 | dose −15 % off target, pump −1.8 psi | α 1.0 (−15 %) | α 0.8 (−12 %) | α 0.7 (−11 %) |
| WSIT02 | blanket 33 → 58 %, 13.9 %/h | α 0.8 (33 → 53 %) | α 0.7 (33 → 51 %) | α 0.6 (33 → 48 %) |
| WSIT03 | headloss +1.95 ft, 0.33 ft/h | α 0.5 (+1.0 ft, 0.21 ft/h peak) | α 0.4 (+0.8 ft) | α 0.3 (+0.6 ft) |
| WSIT04 | swings 1.8–4.6 NTU | α 0.5 (1.9–3.3 NTU) | α 0.3 (2.0–2.8 NTU) | α 0.2 |
| WSIT05 | raw 9 → 68 NTU (7.6×) | α 0.3 (9 → 27 NTU, 2.9×) | — | α 0.2 (9 → 21 NTU) |
| WSIT07 | T₁₀ 35 → 29 min, CT 128 vs 120 | α 0.7 (35 → 30.8 min, CT 136) | α 0.6 (35 → 31.4 min) | α 0.5 |

WSIT06 was not scaled: backwashes are discrete, so its floor is the rule
itself — three washes inside four hours with a mean gap under 90 minutes.
One extra wash in a shift (T05's, at 12:30) is below it by design, which is
why that filter stays quiet.

**Timing differences with the item narratives.** Worth aligning the text in
`generate.py` the next time it is regenerated:

- WSIT01: the item is dated from 09:40 and resolved at 11:30. The detector
  sees the drift from 10:40 (first below −4 %) and raises at 11:25, once the
  residual has been past −10 % for 20 minutes.
- WSIT02: the item starts at 10:20. The rise becomes measurable at 10:45 and
  the detector raises at 11:25, when the blanket is 48 % and has been rising
  faster than 8 %/h for half an hour.
- WSIT03: the item says since 08:30. The detector needs a full two-hour
  window to measure a rate, so it cannot look before 10:00 and raises there.
- WSIT04: the first sample that jumps more than 0.4 NTU is 09:40 (the item
  dates the noise from 09:35, the sample before it); the detector raises at
  09:55, on the fourth jump.
- WSIT05: the storm is logged at 10:52. The detector raises at 11:20, once
  raw turbidity is past 2× baseline and rising faster than 15 NTU/h.
- WSIT06: the item is dated from 11:00. The detector raises at 12:45, one
  sample after the third backwash — the same rule pharma's micro-stops
  detector uses.
- WSIT07: the maintenance starts at 13:00. The margin only falls under 18 %
  at 13:35, and the detector raises at 13:45 once that has held and the
  projection is inside 90 minutes.

**Data quirks found while building them.**

- WSIT01's text says "no operator setpoint change logged in the same
  window". The pack has no dose setpoint series, so the explanation argues
  it from the pump instead: a setpoint cut takes flow away without taking
  discharge pressure or stroke stability with it.
- WSIT04's grab-sample reading (2.0 NTU) exists only in the item text and
  the work item, not as a series. The detector compares the sensor with
  itself either side of the episode and with the filter downstream, and
  treats the field check as confirmation, not as evidence.
- WSIT06's `evidence` array is event codes (1 = a wash in that sample), not
  a series the detector could use. It counts headloss resets instead and
  confirms each one against the backwash pump.
- WSIT07 has no work item, so its `action.workItemIds` is empty and the
  recommendation stands on its own.
- `weir_overflow_rate_gpd_ft` carries `unit: "ft"` in `properties.json`
  though it is a gpd/ft loading; the explanation writes gpd/ft.
- T01's and T04's raw turbidity drift up 30–60 % over the shift (normal
  AR(1) movement plus T04's step), which is why the dose detector's band on
  the raw water has to be wide enough to let a storm through and still
  exclude T03's.

**Limits.** These are reference detectors. The thresholds come from
RESEARCH.md — the 0.3 NTU filtered-water limit and the <2 NTU settled goal
[1][3], 24–72 hour filter runs and UFRV [4][6], CT and T₁₀ [2], and the 45 %
blanket level above which this pack's physics adds carryover — and were
checked against this simulated data only. Several of them compare one train against the other
five, which fails if the whole plant drifts together; the dose, blanket,
headloss and contact-time baselines are learned from the first 90–120
minutes of the window, so a fault already present at 08:00 would be
invisible. On a real plant they are a starting point to tune on the site's
own history, not a validated product.

## Validator warnings and why they're accepted

The same three as the converted pack; none can be removed without changing
keys or items that saved settings and the stable item set depend on.

- **`[properties]` type train has 9 properties.** The original train KPI set
  (OEE, availability, quality, WIP, instability, health, flow efficiency,
  target, throughput) is kept because saved per-type display settings are
  keyed by it.
- **`[scenarios]` all items are on one hierarchy level.** All seven original
  items sit on stages; items keep their assets.
- **`[scenarios]` no item within 30 min of now.** The newest item (WSIT07)
  started 65 minutes before now; item timing is kept.
