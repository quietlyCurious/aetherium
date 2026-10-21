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

## Detectors and explanations (spec §14)

`explain.py` runs five detectors, one per failure mode, on every asset each
applies to, and writes `public/data/wastewater/explanations.json`. Each one
reads only the runtime files through `detectors/pack.py` — never this sheet,
`generate.py`'s constants, or an attention item's own signal, detail or
evidence text. Work items are read only for confidence and for the DMR
deadline.

Confluence is six identical parallel trains on one influent and one diurnal
flow curve, so "expected" here is usually **what the other five trains read
at the same moment**. Where the six differ by design — each blower is a
different size on its own system curve — the reference is the asset's own
reading early in the shift, and the other trains only rule out a plant-wide
cause. Two checks are pure physics with no fitted coefficients: a blower's
flow and discharge pressure have to move the same way on a system curve, and
disinfection risk goes as (CT₀/CT)².

| Item | Detector | Ran on | Fired on | Raised at | Confidence |
|---|---|---|---|---|---|
| WSIT08 | `wastewater.blower_air_shortfall` | 6 aeration stages | T03 · Aeration (root cause: its Blower) | 10:00 | high |
| WSIT09 | `wastewater.sludge_settleability_drift` | 6 secondary clarifiers | T01 · Secondary Clarifier | 12:55 | medium |
| WSIT10 | `wastewater.clarifier_collector_stall` | 6 primary clarifiers | T05 · Primary Clarifier (root cause: its Sludge Collector) | 10:30 | high |
| WSIT11 | `wastewater.ras_load_imbalance` | 6 aeration stages | T02 · Aeration (root cause: T02 · Secondary Clarifier, where the RAS rate is set) | 12:05 | high |
| WSIT12 | `wastewater.effluent_margin_before_dmr` | 6 disinfection stages | T04 · Disinfection | 13:25 | n/a |

**No detector fired anywhere else** — not on T06 (the quiet reference train)
and not on any other train's stage of the same type, so there are no extra
detections to explain away. Every candidate asset is evaluated: all six
aeration stages, all six primary and all six secondary clarifiers, all six
disinfection stages.

### What each one checks

**`wastewater.blower_air_shortfall`** — archetype 05, seen as 07. The symptom
is on the stage and the cause is on its blower, so the detector walks the
`air_flow` layer from the stage's diffuser grid back to the blower that feeds
it and reads the cause there.

- *required* DO under the 1.5 mg/L nitrification floor for 30 minutes.
- *required* header air flow under 88 % of the median of the other five trains
  for 30 minutes (onset walked back to where it first fell under 95 %).
- *required* **the cause, on the blower:** its own air flow ≥ 12 % below its
  first-15-minute level **and** its discharge pressure ≥ 5 % below. On a system
  curve less air means less friction loss, so flow down *with* pressure down
  puts the restriction on the blower's own side; a plugged diffuser would push
  the pressure up.
- *required* F:M and MLSS inside the conventional bands throughout — if demand
  had risen the DO controller would have asked for more air, not less.
- *supporting (independent)* blower discharge temperature up > 4 °C (pressure
  ratio); diffuser backpressure down > 10 % and coverage down > 2 points (the
  opposite of fouling); secondary TSS removal lower while DO was under the
  floor; recovery to ≥ 92 % of baseline air after the done maintenance.
- *supporting* every other aeration stage above 1.5 mg/L on normal air.

On the committed seed: DO 2.07 → 0.59 mg/L, air 1,907 → 1,381 scfm (−28 %),
discharge pressure −17 %, discharge temperature +13.2 °C, diffuser
backpressure −31 %. The explanation sets `rootCauseAssetId` to the blower.

**`wastewater.sludge_settleability_drift`** — archetype 13.

- *required* SVI above 130 mL/g for 45 minutes; up > 25 mL/g on its own first
  hour; rising > 4 mL/g per hour over the last four hours.
- *required* RAS rate and clarifier torque have no trend (|slope| < 2.5 per
  hour) and RAS stays inside 25–75 % — nothing hydraulic, nothing mechanical.
- *supporting (independent)* secondary TSS removal down > 1 point on its own
  first hour.
- *supporting* the climb is smooth (largest 5-minute step 1.26 mL/g here against
  4.6–6.9 on the other five clarifiers); the other five clarifiers flat; MLSS,
  F:M and sludge age inside their bands; the microscopic exam still open, which
  is what holds the conclusion at medium.

A **slope** is used for "RAS and torque never changed" rather than two window
means: a 2-hour mean of these AR(1) signals wanders two to five points on
noise alone, which made an earlier mean-based gate miss on 7 of 10 seeds.

**`wastewater.clarifier_collector_stall`** — archetype 11 with a 09-style
knock-on.

- *required* the child sludge collector's motor current ≤ 0.1 A and travel
  speed ≤ 1 % in one interval, from running.
- *required* primary TSS removal > 10 points below its pre-stop median within
  20 minutes.
- *supporting (independent)* the sludge blanket up > 5 points within 45 minutes;
  primary BOD removal down > 2 points; TSS removal back to ≥ 97 % of its
  pre-stop level within 45 minutes of the restart.
- *supporting* drive current > 8 % above its own running median in the 30
  minutes before the trip (mechanical overload, not an electrical drop-out);
  the stall at the 81st percentile of the train's own day for influent flow;
  the other five primaries within 12 points through the same peak (which is
  what rules the peak flow out as a cause on its own); the knock-on into the
  aeration stage the basin feeds on the `process_flow` layer.

The blanket check is *supporting*, not required: on 1 seed in 20 the blanket
rose only 4.9 points against the 5-point level, and the collector stop plus the
22-point removal loss already carry the conclusion.

**The knock-on check is honest about its own weakness.** T05's aeration F:M
rose +0.021 and DO fell 0.30 mg/L in the hour after the stall, but the other
five aeration stages moved +0.016 to +0.034 on F:M over the same window on the
morning peak alone. The check says so in its `why`: consistent with the stall,
not proof of it.

**`wastewater.ras_load_imbalance`** — archetype 03. The RAS loop is found by
walking `sources[process_flow]` of the stage's aeration basin to the RAS pump
and up to its parent secondary clarifier, which is where `ras_rate_pct` lives.

- *required* F:M above the 0.32 design ceiling for 30 minutes, having risen
  > 0.040 over the preceding two hours.
- *required* RAS rate standard deviation < 0.6 points **over the two hours F:M
  spent climbing** (0.21 here against 1.08–1.55 on the other five trains).
- *required (independent)* header air flow up > 2.5 % from the F:M low point to
  its peak — the DO controller can see the extra oxygen demand, so the load
  rise is real and not an F:M arithmetic artefact.
- *supporting* MLSS never built to meet the load; influent flow up; DO held
  above 1.5 mg/L (not an air problem); SVI under 130 mL/g (not biology); the
  other five trains' RAS moving and none of them over the ceiling for more than
  5 minutes; and the response — RAS +6.9 points, pump flow +12 %, MLSS
  +574 mg/L, F:M back inside the band 10 minutes later, which is what makes the
  confidence high.

The RAS standard deviation is measured over the climb, not at the flag: by the
flag the correction has usually already moved RAS, which made an earlier
version miss on 9 of 10 seeds.

**`wastewater.effluent_margin_before_dmr`** — archetype 14. This one asks about
the number that is about to be reported, so the required condition has to hold
*now* and the raise time is where the current run of it started.

- *required* every sample in the last hour under the limit of 20, and the
  half-hour average leaving less than 40 % of the limit in margin (6.3 here).
- *required (independent)* **the hydraulic driver:** this train's share of the
  six trains' throughput up > 1.5 % over the last hour against the rest of the
  shift (+4.2 % here, while the other five moved −1.7 to +0.3 %). Comparing
  *shares* removes the plant-wide diurnal curve, so this separates "this train
  is taking more flow" from "the plant is at its peak".
- *required* mean chlorine residual inside 0.5–1.0 mg/L and mean CT within 15 %
  of its own baseline — healthy equipment, which is what makes this a
  compliance item rather than a fault.
- *supporting (independent)* the (CT₀/CT)² physics split: CT was −6.9 % at the
  peak, which accounts for +1.5 of the +5.2 rise; the remaining +2.9 is solids
  and load carried through, not lost disinfection. Dechlorinated residual under
  0.15 mg/L.
- *supporting* the index is flat (+2.0 per hour, under the 3-per-hour "stable"
  level), this train is the outlier on both flow share and its own baseline, and
  the open `DOCUMENTATION` task is due 15:30 with 40 minutes of work and 45
  minutes of slack.

**Computed confidence `n/a` against the item's `high`.** The runner warns about
this, as it does for grid's GSIT12. Per §14.5 `high` means confirmed by recovery
or by an inspection, and nothing here has been confirmed — the final effluent
grab sample has not been pulled. The honest answer for an archetype-14 item is
that it is arithmetic off instruments and a work-list deadline, not a diagnosis,
which is what `n/a` says. The item's own wording ("Confirmed — within
compliance, being tracked proactively") is about the compliance status, not
about a diagnosis, so the two are not really in conflict; the item text was not
changed. Every other computed confidence matches its item.

### Robustness (spec §14.6)

`python3 ModelAndData/industries/wastewater/robustness.py 10` regenerates the
pack with 10 other seeds (20261828 … 20270828) and runs every detector on each
copy. **Every item was found on all 10, with no extra detections.**

| Item | Found | Raised | Confidence |
|---|---|---|---|
| WSIT08 | 10/10 | 10:00–10:10 | high 10/10 |
| WSIT09 | 10/10 | 12:55–13:00 | medium 9/10, low 1/10 (seed 20261828) |
| WSIT10 | 10/10 | 10:25–10:30 | high 10/10 |
| WSIT11 | 10/10 | 12:00–12:10 | high 10/10 |
| WSIT12 | 10/10 | 13:10–13:40 | n/a 10/10 |

A 20-seed run (20261828 … 20280828) also found all five on all 20 with no extra
detections.

WSIT09 computes `low` instead of `medium` on 1 seed in 10: secondary TSS removal
on T01 happened to end the shift no lower than it started, so the one
independent supporting check didn't match. That signal is genuinely weak — the
SVI → TSS-removal coupling is −0.06 points per mL/g against an hour-to-hour
scatter of about ±3 points — and the detector reports it as it finds it rather
than lowering the threshold into the noise.

### Detection floors (spec §14.8)

Seeds only vary the noise, so each scenario's fault was also shrunk toward its
own baseline in a temporary copy of `generate.py` (anchors and the paired cause
constant scaled together by one factor, 5 seeds per size):

| Item | Full size | 80 % | 60 % | 50 % | Floor |
|---|---|---|---|---|---|
| WSIT08 blower air shortfall (30 % air loss, DO to 0.60 mg/L) | 5/5 | 5/5 | 5/5 | 0/5 | about 60 % (18 % air loss, DO trough 1.28 mg/L); 1/5 at 55 %. At 50 % the DO trough is 1.45 mg/L, so it never holds 30 minutes under the 1.5 mg/L floor |
| WSIT09 SVI rise (+47 mL/g) | 5/5 | 3/5 | 0/5 | — | about 80 % (+38 mL/g, peak 133); at 70 % the peak never clears the 130 mL/g watch level |
| WSIT10 collector stall (23-point TSS loss) | 5/5 | 5/5 | 4/5 | 3/5 | about 50 % (11.5-point loss); at 40 % the 9-point loss is under the 10-point flag level |
| WSIT11 F:M drift (0.28 → 0.35) | 5/5 | 0/5 | — | — | about 90 % (3/5) and 95 % (4/5); at 80 % the peak of 0.336 spends too little time over 0.32 to hold 30 minutes |
| WSIT12 coliform margin (+5 index points, +5 % flow) | 5/5 | 4/5 | 2/5 | 0/5 | about 60–80 %; 1/5 at 55 %. Below that the margin stays above 40 % of the limit |

WSIT11 has the tightest floor because the whole event is 2 hours 10 minutes
long and the detector needs 30 minutes of it above the ceiling; a shallower
drift is caught later or not at all within the window. On a real plant the
sustain time would be tuned against how long an operator is willing to wait.

### Data quirks and judgement calls found while building these

- **T01's DO is the lowest in the plant in the last two hours (1.61 mg/L mean),
  and low DO is the classic trigger for filamentous bulking.** WSIT09 does not
  claim it: the SVI left its baseline at 09:20, hours before the DO reached its
  lowest, and T01 never spent more than 15 minutes under 1.5 mg/L. It is carried
  as a "not yet checked" rule-out with the numbers and the timing argument, and
  flagged as something that could be feeding the trend now.
- **WSIT08 raises at 10:00, not at the item's 10:45 low point.** The detector
  has DO under the floor for 30 minutes and the air shortfall confirmed by then,
  so it would have flagged 45 minutes before the inspection started.
- **WSIT10 raises at 10:30, 10 minutes after the stall**, as soon as TSS removal
  has lost its 10 points. WSIT12 raises at 13:25 against the item's 13:10 start.
- **WSIT11's `rootCauseAssetId` is the secondary clarifier**, because
  `ras_rate_pct` is a property of that stage — that is where an operator reads
  and sets the rate. The RAS pump is named in the evidence instead.
- **T03's fecal coliform risk runs higher than T04's all day** (12.5 baseline
  against 9.7), which is why WSIT12 cannot use an absolute level: its required
  gates are the margin, the flow share and the healthy-disinfection test, and
  "above its own morning" is only supporting.
- **The secondary TSS removal signal is weak everywhere.** It is used only as a
  supporting check (WSIT08, WSIT09) with the peer comparison stated alongside it,
  never to decide firing.
- **Explanations are 20–22 KB per item**, above the 13–16 KB of the packs with
  11 items each. That is deliberate: with only five items there was room for
  9–10 checks each instead of 5–7.

**Limits.** These are **reference detectors**. Their thresholds come from
RESEARCH.md (DO 1.5–2.5 mg/L with ≥ 2 for nitrification, SVI 120/150 mL/g, F:M
0.20–0.40 d⁻¹, RAS 25–75 % of influent, residual 0.5–1.0 mg/L, CT = 2.84 ×
residual × contact time) and were checked against this simulated data, so they
are a starting point to tune on a customer's own history, not a validated
product. Comparing against the other five trains fails if the whole plant drifts
together — three of the five detectors lean on that comparison. The blower
baseline is taken from the first 15 minutes of the window, so a restriction
already present at 08:00 would be invisible. WAS flow, inlet-filter
differential pressure, influent strength, nutrients and effluent TSS are not
instrumented in this model, and each one is named in the rule-outs that would
otherwise need it.

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
