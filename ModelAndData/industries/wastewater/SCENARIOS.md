# Wastewater — scenario sheet (Confluence, 28 Aug 2026)

"Now" is **14:05**. The timeline is 08:00–14:05 at 5-minute steps (74
points). The five attention items and their narratives come unchanged from
the original hand-built pack (see RESEARCH.md); `generate.py` now writes
each story into the data. Its constants are the `SCENARIOS` block at the
top of `generate.py`, and the evidence values in `attention-items.json`
are read back from the generated series at the evidence times, so this
sheet, the data and the narrative agree.

**The day:** dry weather, all six trains `STEADY` on reclaimed effluent. A
plant-wide diurnal curve takes influent from −1.8 % at 08:00 to a
late-morning peak of +1.8 % around 10:45, easing to −1.2 % by 14:05; each
train has its own small share bias and slow drift on top.

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:05 |
|---|---|---|---|
| WSIT08 | 05 Component degradation (seen as 07: symptom on the stage, cause on its Blower) | T03 · Aeration (stage) | resolved, high |
| WSIT09 | 13 Quality drift | T01 · Secondary Clarifier (stage) | **open** — investigate |
| WSIT10 | 11 Hard block (with a 09-style knock-on into aeration) | T05 · Primary Clarifier (stage) | resolved, high |
| WSIT11 | 03 Quiet drift (control effort not following load) | T02 · Aeration (stage) | resolved |
| WSIT12 | 14 Plan / compliance at risk | T04 · Disinfection (stage) | **open** — act, low |

5 items, 5 archetypes, 5 of the 6 trains (T06 is the quiet reference
train, archetype 01), 4 stage types, all on the `stage` level (every one is
a non-leaf asset). 2 open, 3 resolved, none recovering. Archetype 01 is
T06 and every asset without a story. The set is the original pack's and
is kept as is (ids and counts are frozen); its gaps against spec §4.1 — no
06 instrument-fault item, no recovering item, nothing within 30 minutes of
now, fewer than 6 items, one level only, and no planned work (archetype
02) — are listed under the validator warnings below.

## Scenarios

### WSIT08 — Blower intake filter fouling starves T03 of air (05)

- **Asset:** `CONFLUENCE_T03_AERATION`. **Primary:** `dissolved_oxygen_mg_l`.
  **Root cause:** `CONFLUENCE_T03_AERATION_BLOWER` (on the `air_flow`
  layer: Blower → Diffuser Grid → Aeration Basin).
- **Timeline:** filter restriction starts 08:15; DO leaves its 2.3 mg/L
  baseline at 08:20 and falls steadily (1.9 at 08:55, 1.5 at 09:30, 1.1 at
  10:05, 0.8 at 10:25) to **0.6 mg/L at 10:45** (lowest; inspection starts
  10:48). Filter cleared 10:52; air is back by 10:55; DO 1.8 at 11:05 and
  2.2 at 11:25, then normal. Resolved at 10:45 (`since` 3h 20m).
- **Data footprint:**
  - Blower air-delivery factor ramps 1.00 → 0.70 (08:15 → 10:45), back to
    1.00 at 10:55. Blower `air_flow_scfm` ≈ 1,900 → 1,380 scfm; the stage
    header meter `blower_air_flow_scfm` ≈ 4,200 → 3,100 scfm.
  - Blower `blower_discharge_pressure_psi` falls ≈ 15 % (system curve:
    static head + friction ∝ flow²); `discharge_temp_c` rises ≈ +9 °C
    (higher pressure ratio across the restriction); `vibration_mms`
    +0.5 mm/s at the worst point.
  - Diffuser grid `backpressure_psi` falls with the air (≈ 1.3 → 0.95 psi)
    and `air_distribution_uniformity_pct` drops ≈ 5 points (coverage is
    poor below 95 % of design air).
  - Secondary TSS removal on T03 loses ≈ 1.5 points while DO is below
    1.5 mg/L (pin floc); T03 health dips ≈ 1.5 points, quality factor
    ≈ 0.5, availability ≈ 0.3, then all recover.
- **Ruled out:** an oxygen-demand spike (F:M, MLSS and influent flow on T03
  are normal; air falls instead of rising).
- **Work items:** wk-w09 (blower intake filter inspection, done 10:52).

### WSIT09 — Early filamentous bulking on T01 (13)

- **Asset:** `CONFLUENCE_T01_SECONDARY_CLARIFIER`. **Primary:**
  `sludge_settleability_svi`.
- **Timeline:** SVI flat at 95 mL/g until 09:00, then climbs all shift:
  103 (09:50), 112 (10:35), 121 (11:25), 130 (12:10), 136 (13:00), 140
  (13:30), **142 mL/g at 14:05** — still under the 150 action level in the
  recommendation. Open since 09:00 (5h 5m).
- **Data footprint:** `secondary_tss_removal_pct` on T01 drifts down with
  SVI (−0.08 points per mL/g, ≈ −3.8 by now: carryover risk); T01 fecal
  coliform risk rises slightly (+0.15 % per mL/g of SVI); T01 quality
  factor and health lose ≈ 0.3 points by 14:05. **Deliberately unchanged:**
  T01 `ras_rate_pct`, `clarifier_torque_pct` and aeration MLSS/DO, as the
  narrative says ("no corresponding change in RAS rate or clarifier
  mechanical load").
- **Ruled out:** hydraulic or RAS causes (both normal), mechanical load.
- **Work items:** wk-w10 (mixed-liquor microscopic exam, open, due 14:45).

### WSIT10 — T05 primary sludge collector trips at peak flow (11)

- **Asset:** `CONFLUENCE_T05_PRIMARY_CLARIFIER`. **Primary:**
  `primary_tss_removal_pct`. **Root cause:**
  `CONFLUENCE_T05_PRIMARY_CLARIFIER_SLUDGECOLLECTOR`.
- **Timeline:** 10:15 drive current +12 % (overload building at the
  late-morning peak); **10:20 trip** — `motor_current_a` and
  `travel_speed_pct` go to 0 for 10:20–10:30 (`cycle_time_min` holds its
  last value while stopped); restart 10:33 (first running sample 10:35) at
  115 % speed to 10:50 and +25 % current easing off. TSS removal 61 % →
  58 → 52 → 45 → **38 % at 10:35** → 52 → 59 → 61 % at 10:55. Resolved at
  12:05 per the original item (`since` 2h 0m).
- **Data footprint:** `sludge_blanket_level_pct` +11 points by 10:35, +6 at
  10:50, back by 11:20; `primary_bod_removal_pct` follows TSS at half the
  relative loss (≈ 30 → 26 %). Downstream (process-flow edge primary basin
  → aeration basin): the escaped solids add up to ≈ 9 % organic load to T05
  aeration with a lag, so F:M rises ≈ 0.02 around 10:40–10:50. T05
  availability −0.8, OEE −1.3, health −0.9 points during the stop.
- **Ruled out:** a hydraulic surge alone (other trains saw the same peak
  and kept their TSS removal).
- **Work items:** wk-w11 (drive chain inspection, done 10:40).

### WSIT11 — T02 RAS held on a manual setpoint while load rose (03)

- **Asset:** `CONFLUENCE_T02_AERATION`. **Primary:**
  `food_to_microorganism_ratio`.
- **Timeline:** T02 `ras_rate_pct` sits on a manual 38.5 % all morning
  (tight noise, ≈ ±0.3). Organic load starts rising at 10:30, so F:M
  climbs 0.28 → 0.30 (11:00) → 0.32 (11:30) → 0.34 (12:00) → **0.35 at
  12:05**, when RAS is raised to 46 % (lagged step, then normal noise).
  MLSS builds 2,850 → 3,150 mg/L by 12:40, and F:M is back to 0.28 at
  12:40. Resolved 12:10 (`since` 1h 55m).
- **Data footprint:** RAS pump `flow_rate_gpm` steps up with the RAS rate
  (≈ +10 % on average after 12:05) and its motor current and discharge pressure follow; the load
  rise lifts T02 blower air and header air ≈ 9 % (air demand ∝ load⁰·⁴)
  with DO dipping slightly; clarifier torque rises a little with MLSS; T02
  quality factor dips ≈ 0.3 around 12:00.
- **Ruled out:** a blower or DO problem (DO holds, air rises to meet
  demand), a biology upset (SVI normal on T02).
- **Work items:** wk-w12 (RAS rate review, done 12:08).

### WSIT12 — DMR due with fecal coliform risk borderline on T04 (14)

- **Asset:** `CONFLUENCE_T04_DISINFECTION`. **Primary:**
  `effluent_fecal_coliform_risk`.
- **Timeline:** T04 influent rises 5 % between 12:45 and 13:10 and stays
  there. The risk index leaves its ≈ 10 baseline around 12:55 and holds
  **between 12 and 15** from 13:10 (12.1, 12.4, 13.3, 14.1, **14.8 at
  14:00**, 12.2 at 14:05), under the limit of 20. Open since 13:10 (55m).
- **Data footprint:** T04 `line_throughput` +5 %; contact basin
  `residence_time_min` −5 %, so CT dips ≈ 5 % but stays in its normal band;
  chlorine residual stays nominal (feedback-controlled) and the
  flow-paced chlorine and bisulfite doses rise with flow. T04 quality
  factor loses ≈ 0.1 at the 14:00 peak.
- **Ruled out:** a disinfection equipment fault (residual and CT nominal).
- **Work items:** wk-w13 (prepare the DMR filing, open, due 15:30).

## Evidence: before and after the generator

Evidence values are now read from the generated series (3 decimals); the
display strings keep the story's own precision.

| Item | Converted pack | Generated (seed 20260828) |
|---|---|---|
| WSIT08 DO, mg/L | 2.3 1.9 1.5 1.1 0.8 0.6 1.8 2.2 | 2.292 1.894 1.484 1.097 0.798 0.592 1.817 2.208 |
| WSIT09 SVI, mL/g | 95 103 112 121 130 136 140 142 | 94.858 103.068 111.789 121.130 130.215 136.233 140.051 142.147 |
| WSIT10 TSS removal, % | 61 58 52 45 38 52 59 61 | 61.132 58.048 51.923 45.116 37.978 51.922 58.985 60.795 |
| WSIT11 F:M | 0.28 0.30 0.32 0.34 0.35 0.31 0.28 | 0.278 0.300 0.320 0.341 0.350 0.310 0.279 |
| WSIT12 coliform risk | 10 11 13 14 15 13 (points showed "…12") | 12.149 12.498 13.345 14.159 14.848 12.293 |

WSIT12 changed on purpose: the item's text says the index "has held
between 12 and 15 … since 13:10", which the old 10 and 11 at 13:10 and
13:25 contradicted (and the old evidence array said 13 where the point
said 12 at 14:05). The generated values make the text true; no text was
edited.

## Seed robustness

Regenerating with other seeds (the `SEED = …` line substituted, as the
other packs' `robustness.py` do) keeps every story: evidence within display
rounding of the story values, DO falling monotonically to 10:45 with the
blower air below 80 % of its 08:05 value, SVI rising monotonically and
staying under 150 with T01 RAS in its normal band, TSS lowest at 10:35 with
the collector current at 0 A for 10:20–10:30, F:M peaking at 12:05 with T02
RAS held near 38.5 % and above 43 % after the change, and T04 coliform
risk inside 12–15 from 13:10 peaking at 14:00. Checked on 20 seeds
(20261828 … 20280828): all validate with 0 errors and the same 6 warnings.
On 4 of those 20 seeds one healthy series touches its gauge limit and is
clipped there for a sample or two (the committed seed has none).

## Validator warnings and why they're accepted

`python3 ModelAndData/tools/validate_industry_pack.py wastewater` gives
0 errors and the same 6 warnings as the converted pack. All six come from
the frozen model design (saved settings and asset sets are keyed by the
ids, property keys and items), not from the generated data:

- `type train has 9 properties (§3.3: about 2–8)` — the train carries the
  original line KPI set; removing a key would break saved layouts.
- `5 attention items (§4.1: 6–14)` — the item set is frozen for this
  task; adding items is a design change for Amy.
- `all items are on one hierarchy level` — all five original items sit on
  stages.
- `no recovering item` — the originals are either resolved or open.
- `no item within 30 min of now` — the newest item (WSIT12) started 55
  minutes before now.
- `5 work items (§7: 8–15)` — the original work list; there are no planned
  routine tasks.
