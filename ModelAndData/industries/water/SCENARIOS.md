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
