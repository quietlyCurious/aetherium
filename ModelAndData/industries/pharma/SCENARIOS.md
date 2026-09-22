# Biologics (mAb) — scenario sheet (Solace Park, 28 Aug 2026)

"Now" is **14:05**. The timeline is 08:00–14:05 at 5-minute steps. Each
scenario's constants live at the top of `generate.py`. The evidence points
and numbers quoted in `attention-items.json` are read back from the
generated series, so this sheet, the data and the narrative agree.

**The day (batch board at 08:00):**

| Unit | Batch / phase |
|---|---|
| SBR-1 | N-1 seed for **26-117**, day 3.6; transfer to PBR-3 planned 18:00 |
| PBR-1 | **26-114**, day 12.85, shifted to 33 °C; harvest planned tomorrow 08:00 |
| PBR-2 | **26-116**, day 6.9, near peak cell density |
| PBR-3 | turnaround after harvesting **26-113** yesterday 18:30: CIP 08:00–09:40, SIP from 10:00 |
| HRV-1 | clean, standby (harvested 26-113 yesterday) |
| CAP-1 → VIN-1 | Protein A cycles 1–5 of 8 on **26-113**; eluates collect in VIN-1 |
| POL-1 | AEX/CEX polishing of **26-112** from 08:30 |
| VF-1, UFDF-1 | VF-1 standby (pre-use flush 13:00–13:30); UFDF-1 CIP 12:00–13:50, then NWP test |
| BDS-1 | four frozen lots at −45 °C |
| Utilities | WFI-1, CSG-1, CIP-1, AHU-3 (post-viral suite), MP-1 (26-117 medium from 11:30), BP-1 (new buffer lot 10:00–11:00) |

The site's **open deviations** count goes 2 → 6 during the shift: CAP-1
interruption (10:00), PBR-3 SIP abort (10:45), post-viral suite pressure
excursion (12:15), PBR-2 pCO₂ above NOR (12:20).

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:05 |
|---|---|---|---|
| PSIT01 | 05 Component degradation | PBR-1 · Agitation (equipment module) | **open**: investigate |
| PSIT02 | 06 Signal noise (instrument) | SBR-1 · Gas Control · DO Probe B (control module) | resolved |
| PSIT03 | 07 Ghost signal | PBR-3 · Temperature Control (equipment module); cause is **CSG-1** | resolved, high |
| PSIT04 | 11 Hard block | CAP-1 (unit, non-leaf) | resolved, high |
| PSIT05 | 08 Throughput illusion | CAP-1 · Protein A Column (equipment module) | **open**: investigate |
| PSIT06 | 09 Cascade failure | AHU-3 (unit, non-leaf) | **recovering**, high |
| PSIT07 | 04 Accumulation | PBR-2 · Gas Control · pCO₂ Probe (control module) | **open**: act, high |
| PSIT08 | 03 Quiet drift | WFI-1 · Multi-Effect Still (equipment module) | resolved |
| PSIT09 | 12 Recurring micro-events | PBR-2 · Feed Addition · Feed Pump (control module) | resolved |
| PSIT10 | 13 Quality drift | PBR-1 (unit, non-leaf) | **open**: investigate |
| PSIT11 | 14 Plan / compliance at risk | SBR-1 (unit, non-leaf) | **open**: act, **new** (25 min) |

**Totals:**

- 11 items covering 11 archetypes, including the required 05, 06, 07, 09
  and 11. Archetypes 01 (normal) and 10 (overcorrection) have no item.
- 7 of 17 units: SBR-1, PBR-1, PBR-2, PBR-3, CAP-1, AHU-3, WFI-1.
- 11 asset types across 3 levels (unit, equipment module, control
  module). Four items sit on non-leaf assets.
- Outcomes: 5 open, 1 recovering, 5 resolved. Two `act` items, four
  `high` severity items, one item started 25 minutes ago.
- **Archetype 01 (normal)** is everything else: VIN-1, POL-1 apart from
  its AHU-driven hold, VF-1, UFDF-1's CIP, BDS-1, CIP-1, MP-1, BP-1 and
  every room sensor outside 12:10–12:30.
- **Archetype 02 (busy-but-normal)** is the planned work list: handover
  huddle, two daily bioreactor samples, WFI point-of-use sampling, routine
  EM, batch record review, and the 26-117 medium release (due 15:30).

**Unit tiles at 14:05:**

- `attention`: PBR-1 (since 09:20), PBR-2 (since 10:15), CAP-1 (since
  11:50), SBR-1 (since 13:40).
- `changeover` (mode `CHANGEOVER`): PBR-3 (since yesterday 18:30, 19h 35m)
  and UFDF-1 (since 12:00). No other generic pack shows this state.
- `running`: everything else. HRV-1 and VF-1 carry mode `STANDBY`. PBR-3's
  and AHU-3's items are resolved/recovering, so neither tile is
  `attention`.

## Scenarios

### PSIT01 — PBR-1 agitator gearbox wear (05)

- **Asset:** `SOLACE_USP_PROD_PBR1_AGIT`. **Primary:** `gearbox_vibration_mms`.
- **Story:** from 09:20 vibration rises smoothly and faster over time, from
  1.9 to 4.5 mm/s at 14:05 (alert 4.5, alarm 7.1). Speed stays at 48 rpm.
- **Secondary signals:** seal temperature 44 → 52 °C (advisory alarm at
  12:40); agitator power +3%. PBR-2's identical drive stays at 1.7 mm/s.
- **Related:** the parent PBR-1's viability decline (PSIT10) is listed as a
  possible link, not a confirmed one.
- **Ruled out:** process load (DO, pH, temperature, speed unchanged).
- **Times:** start 09:20; open. **Work:** wk-s07 (vibration route), not
  done, due 15:00.
- **Why it's realistic:** RESEARCH §5 #6 *(practice)*.

### PSIT02 — SBR-1 DO probe B intermittent (06)

- **Asset:** `SOLACE_USP_SEED_SBR1_GAS_DOB`. **Primary:** `do_pct`.
- **Story:** 09:35–10:40 probe B jumps between 14% and 64% (eight large
  spikes plus smaller jitter). Its signal-quality index drops to ~57.
- **What doesn't move (the point):** probe A (39.5–40.7%), O₂ sparge
  (±0.3 slpm), pCO₂, pH and seed VCD.
- **Times:** start 09:35; connector reseated 10:40; clean from 10:45
  (resolved). **Work:** wk-s01, done 10:40.
- **Why it's realistic:** RESEARCH §5 #2 [17][21].

### PSIT03 — PBR-3 SIP cold point; cause upstream at CSG-1 (07)

- **Asset:** `SOLACE_USP_PROD_PBR3_TEMP`. **Primary:** `drain_temp_c`.
  **Root cause asset:** `SOLACE_UTIL_CU_CSG1` (edge `clean_steam`).
- **Root cause first:** CSG-1 generator level starts hunting 42–69% at
  10:10 (feed-pump cavitation). Header pressure sags from 3.0 to 1.66
  bar(g) from 10:20, and steam flow to PBR-3 is capped at ~480 kg/h.
- **Symptom (10–20 min later):** PBR-3 vessel stalls at ~119 °C and the
  drain peaks at **115.5 °C at 10:40**, below the 121.1 °C hold criterion.
  Vessel pressure 1.10 → 0.92 bar(g). SIP #1 aborted 10:45 (deviation).
- **Fix and recovery:** strainer cleaned 11:10, header back at 3.0 by
  11:20. SIP #2 11:40, hold 12:10–13:10 with drain ≥ 122.0 °C (F₀ ≈ 74
  min from the 5-minute data), cool-down, complete 13:25 (resolved).
- **Ruled out:** PBR-3 steam traps (checked OK).
- **Knock-on:** 95 minutes lost → PSIT11. **Work:** wk-s03, done 11:12.
- **Why it's realistic:** RESEARCH §5 #8, #9 [4][11].

### PSIT04 — CAP-1 stopped on guard filter DP high-high (11)

- **Asset:** `SOLACE_DSP_PUR_CAP1`. **Primary:** `skid_flow_l_min`.
- **Story:** cycle 2 load 09:20. Guard filter DP 0.35 → 0.58 → 0.95 →
  1.45 → 2.18 bar (09:30–09:50), trips the 2.5 bar interlock between
  samples: flow **0 from 09:55 to 10:40**. Filter replaced 10:35; load
  resumes 10:40 (filter DP 0.30 bar), cycle 2 completes 11:05.
- **Related:** VIN-1's second eluate arrives at 10:55 instead of about 10:10; the
  column's own DP is normal throughout. Cause hint: clarified-harvest
  turbidity (HRV-1, edge `process_flow`).
- **Times:** start 09:55, resolved 10:40 (within the 4 h load hold).
  **Work:** wk-s02, done 10:38.
- **Why it's realistic:** RESEARCH §5 #12 [9].

### PSIT05 — Protein A breakthrough rising cycle over cycle (08)

- **Asset:** `SOLACE_DSP_PUR_CAP1_COL`. **Primary:** `breakthrough_pct`.
- **Headline that looks fine:** every cycle loads ~1,400 L at 38/26 L/min
  on schedule; cycles on time; column DP 1.34–1.35 bar.
- **Hidden loss:** end-of-load breakthrough 1.1 → 2.0 → 3.1 → 4.6% (cycles
  1–4); cycle 5 already 4.6% with a sample to go (6.1% at its 14:10 load
  end, just past "now"). Step yield 95.3 → 94.4 → 93.0 → 91.4%, about
  0.5 kg of antibody lost over cycles 2–4. Resin on cycle 191 of 200.
- **Ground truth (not in the open item):** dynamic binding capacity loss
  as the resin nears end of life.
- **Ruled out in the text:** the guard-filter event (only cycle 2).
- **Times:** flagged 11:50 (end of cycle 3 load); open. No work item yet.
- **Why it's realistic:** RESEARCH §5 #11 [6][19].

### PSIT06 — AHU-3 fan trip → post-viral suite pressure loss → POL-1 hold (09)

- **Asset:** `SOLACE_UTIL_CU_AHU3`. **Primary:** `supply_airflow_m3_h`.
- **Cascade, in order (edges `hvac`):**
  1. 12:10 Fan A drive trips: airflow 18,500 → ~1,200 m³/h; HEPA DP falls
     with it.
  2. Same sample: Rm 2.14 DP 15.3 → 1.1 Pa, Rm 2.16 14 → 1.5 Pa, airlock
     AL-7 reverses to −1.3 Pa; room temperature up to 21.3 °C.
  3. 12:10–12:50: POL-1 flow 0 (hold). The downstream area's
     `dsp_load_flow_l_min` and the Purification cell's
     `units_in_service_count` both drop.
- **Recovery:** Fan B started 12:22, running at 12:25; DPs above 5 Pa at
  12:30; POL-1 resumed 12:50. **Recovering**, not resolved: EM plates are
  read at 48–72 h.
- **Not affected:** UFDF-1 CIP (closed), BDS-1 freezer.
- **Work:** wk-s05 (EM sampling and deviation), done 12:48.
- **Why it's realistic:** RESEARCH §5 #17 [12][13].

### PSIT07 — PBR-2 pCO₂ accumulating (04)

- **Asset:** `SOLACE_USP_PROD_PBR2_GAS_PCO2`. **Primary:** `pco2_mmhg`.
- **Ground truth (not in the open item's diagnosis, but visible in the
  data):** at 10:05 the planned exhaust-filter swap left the headspace
  overlay at **30 slpm instead of 120** (`overlay_air_slpm` on PBR-2 · Gas
  Control). The item lists the swap in *what changed* and suggests
  checking the overlay, which is the clue an operator should follow.
- **Story:** pCO₂ 90 at 10:15 → **146 mmHg at 14:05**, ~13 mmHg/h. Leaves
  NOR (120) at **12:20** (minor deviation); PAR 160 would be crossed at
  about 15:05.
- **Secondary (all computed from the same rise):** pH 7.00 → 6.93 (low
  dead-band edge); CO₂ sparge 13 → 2 slpm; base pump 26 → 63 mL/min;
  osmolality 357 → 361 mOsm/kg; off-gas CO₂ 5.3 → 8.5%. Exhaust filter
  DP drops 18.5 → 9 mbar at the swap (new filter).
- **Ruled out:** DO (steady 40%); PBR-1 on the same utilities stays at
  ~85 mmHg.
- **Times:** start 10:15; open (act). **Work:** wk-s06, not done, due
  14:20.
- **Why it's realistic:** RESEARCH §5 #1, #4 [2][8][18].

### PSIT08 — WFI still making less water for more steam (03)

- **Asset:** `SOLACE_UTIL_CU_WFI1_STILL`. **Primary:** `still_output_l_h`.
- **Story:** output 3,058 → 2,708 L/h from 08:00 to 12:40 while plant
  steam rises 778 → 819 kg/h (steam per litre +19%). Vent valve found
  half-closed after yesterday's PM, opened 12:40; output back to 3,050 by
  13:20 (resolved).
- **Related:** WFI tank drops to 62% under the afternoon MP-1 fill and
  UFDF-1 CIP draws (edges `wfi`); loop quality unchanged.
- **Why it's realistic:** RESEARCH §5 #16 *(practice)*.

### PSIT09 — PBR-2 feed pump micro-stops (12)

- **Asset:** `SOLACE_USP_PROD_PBR2_FEED_PUMP`. **Primary:** `feed_pump_rate_l_h`.
- **Story:** eight one-sample stops (08:40, 09:05, 09:25, 09:50, 10:20,
  10:45, 11:10, 11:30); up to 3 in an hour on `feed_interruptions_1h`.
  Tubing replaced 11:45–11:55; catch-up at 40 L/h until 12:40.
- **Related:** feed up to 27 L behind recipe; glucose 4.1 → 3.0 g/L,
  recovering to 3.3 by 14:05 (`feed_added_l` and working volume follow).
- **Times:** start 08:40; resolved 12:40. **Work:** wk-s04, done 11:55.
- **Why it's realistic:** RESEARCH §5 #7 *(practice)*.

### PSIT10 — PBR-1 viability falling faster than forecast (13)

- **Asset:** `SOLACE_USP_PROD_PBR1`. **Primary:** `viability_pct`.
- **Story:** viability 84.1 → 78.5% (forecast 81.9% at 14:05), about 1
  point/h over the last two hours; reaches the 70% harvest criterion
  around **22:10**, before the planned 08:00 harvest.
- **Healthy-looking headline:** titer still rising 5.62 → 5.78 g/L;
  product in vessel and the Upstream area's `area_product_mass_kg` keep
  climbing. VCD 17.3 → 16.4.
- **Times:** flagged 10:00; open. No work item yet (the recommendation is
  a 16:00 sample and an MS&T decision).
- **Why it's realistic:** RESEARCH §5 #19 [1].

### PSIT11 — Seed transfer window vs PBR-3 readiness (14)

- **Asset:** `SOLACE_USP_SEED_SBR1`. **Primary:** `seed_vcd_e6_ml`.
- **Clock:** seed VCD 4.13 at 08:00 → 5.13 at 14:05, doubling every 20 h;
  it passes the **6.0 ×10⁶/mL** transfer limit (static
  `transfer_vcd_max_e6_ml`) at about **18:35**.
- **Time needed:** PBR-3 SIP done 13:25 + pressure hold 60 + cool and fill
  180 + QA release 30 + equilibration 120 min → ready about **19:55**.
  Needed 5h 50m, left 4h 31m: short by about 80 minutes.
- **Why now:** the 95-minute SIP repeat (PSIT03). Flagged by the scheduler
  at 13:40 (the "new" item).
- **Times:** open (act). **Work:** wk-s08 (decision huddle), not done, due
  15:00; wk-p07 (medium release), not done, due 15:30.
- **Why it's realistic:** RESEARCH §5 #20 [1].

## Detectors and explanations (spec §14)

`explain.py` runs eleven detectors, one per failure mode, on every asset each
applies to, and writes `public/data/pharma/explanations.json`. Each one reads
only the runtime files, never this sheet or `generate.py`'s constants. A
biologics plant has few identical machines doing the same duty at the same
time (PBR-1 is on day 13 at 33 °C, PBR-2 on day 7 at 36.5 °C), so "expected"
here is usually the asset's own behaviour over the first hour of the shift
at the same setpoint, a redundant instrument in the same vessel (DO probe A
against B), or physics (steam saturation temperature at the vessel pressure,
F₀). Sister assets are used to rule out shared causes.

| Item | Detector | Ran on | Fired on | Raised at | Confidence |
|---|---|---|---|---|---|
| PSIT01 | `pharma.agitator_drive_wear` | 4 agitator drives | PBR-1 Agitation | 11:50 | medium |
| PSIT02 | `pharma.do_probe_fault` | 8 DO probes | SBR-1 DO Probe B | 09:50 | high |
| PSIT03 | `pharma.sip_cold_point_supply` | 4 temperature modules | PBR-3 Temperature Control (root cause: CSG-1) | 10:30 | high |
| PSIT04 | `pharma.skid_filter_stop` | 2 chromatography skids | CAP-1 (root cause: Guard Filter) | 10:10 | high |
| PSIT05 | `pharma.protein_a_capacity_loss` | 2 chromatography columns | CAP-1 Protein A Column | 11:55 | medium |
| PSIT06 | `pharma.ahu_fan_trip_cascade` | 1 AHU | AHU-3 (root cause: Supply Fan A) | 12:10 | high |
| PSIT07 | `pharma.pco2_accumulation` | 4 pCO₂ probes | PBR-2 pCO₂ Probe | 11:55 | medium |
| PSIT08 | `pharma.wfi_still_drift` | 1 WFI still | WFI-1 Multi-Effect Still | 10:35 | high |
| PSIT09 | `pharma.feed_pump_micro_stops` | 3 feed pumps | PBR-2 Feed Pump | 09:30 | high |
| PSIT10 | `pharma.viability_decline` | 4 bioreactors | PBR-1 | 11:45 | medium |
| PSIT11 | `pharma.seed_transfer_window` | 1 seed bioreactor | SBR-1 (destination PBR-3) | 13:25 | n/a |

No detector fired anywhere else. Every computed confidence matches the
item's `confidenceLevel`. What each one checks (required checks first):

- **Agitator drive wear:** gearbox vibration more than +0.5 mm/s above its
  own first-hour level for 30 min, rising at least 0.15 mm/s per hour with
  no 5-min step over 0.4 mm/s, at a speed within ±1 rpm all shift.
  Supporting: seal temperature +3 °C (independent), power +1.5 % at the same
  speed, other running drives flat. PBR-3's agitator (stopped for the
  turnaround) has no baseline and is left out.
- **DO probe fault:** at least three alternating jumps over 10 points in 30
  min, more than 10 points from the other probe in the same vessel, that
  probe steady within 3 points, and no O₂ sparge step over 1 slpm.
  Supporting: signal-quality index down, VCD kept growing, and within 2
  points of the partner for 30 min after a done instrument check (high).
- **SIP cold point from the supply:** steam on the jacket (≥ 121 °C) for 15
  min, vessel no longer heating (< 1 °C in 10 min) with the drain under
  121.1 °C, and the clean-steam header (followed up the `clean_steam` layer)
  under 2.5 bar(g). Supporting: saturation temperature at the vessel
  pressure under 121.1 °C, clean-steam flow down (supply, not demand),
  generator level hunting, and a later SIP holding ≥ 121.1 °C for 30 min
  with the header ≥ 2.9 bar(g) (high).
- **Skid stopped by a plugging filter:** flow under 1 L/min for 15 min in the
  middle of a load, after a child filter's DP rose more than 1 bar in 30 min
  to over 80 % of the 2.5 bar high-high. Supporting: projected past the
  interlock between readings, column DP per L/min unchanged, eluate late at
  VIN-1, normal flow and DP after a done maintenance item (high). POL-1's
  AHU-driven stop is a candidate and correctly doesn't fire: its AEX filter
  DP was flat.
- **Protein A capacity loss:** cycles split by the skid's `cycle_number`;
  end-of-load breakthrough up at least 0.3 points every cycle for three
  finished cycles (1.5 points in total), the latest above 1.5 %, and load
  volume per cycle within ±5 %. Supporting: step yield falling (independent),
  column DP unchanged, the cycle in progress above the last at the same
  volume, resin cycles in the 100–300 lifetime range. POL-1's CEX column has
  no cycle counter and is never evaluated as cycles.
- **AHU fan trip cascade:** airflow down more than half in one interval with
  a running fan going to under 5 % in the same interval, and a room DP under
  5 Pa. Supporting: HEPA DP fell (independent), room temperature rose,
  a served unit on the `hvac` layer stopped within 10 min, and airflow and
  every room back when the standby fan ran (high).
- **pCO₂ accumulation:** more than +15 mmHg above the first-hour median for
  30 min and still rising faster than 6 mmHg/h over 90 min. Supporting:
  off-gas CO₂ up and the pH loop (pH down, CO₂ sparge down, base up), both
  independent; VCD up under 10 %; an overlay or air-sparge cut of more than
  half in the hour before the onset. Projects NOR and PAR crossings.
- **WFI still drift:** steam per 1,000 L more than 6 % over its first hour
  for 30 min, rising at least 1.5 % per hour with no step over 3 %.
  Supporting: output down and steam up on their own meters (independent),
  loop conductivity and TOC within limits, and ≥ 80 % of the excess gone
  within an hour of the worst point (high).
- **Feed pump micro-stops:** three one-interval stops (rate under 10 % of
  normal, normal either side) within an hour, each restarting by itself.
  Supporting: other feed pumps no stops, glucose down more than 0.3 g/L
  (independent), the pump's interruption counter, no stops for an hour
  after a done repair (high).
- **Viability decline:** more than 1 point below the straight-line trend of
  its first 90 minutes for 30 min, falling faster than 0.5 points/h and 1.5×
  that trend, and reaching the 70 % harvest criterion within 24 h at the
  recent rate. Supporting: O₂ sparge down more than 3 % (independent), VCD
  falling, titer still rising.
- **Seed transfer window:** exponential fit of seed VCD (r² ≥ 0.95) reaches
  the static `transfer_vcd_max_e6_ml`; the empty production bioreactor it
  feeds on `process_flow` has passed its SIP (drain ≥ 121.1 °C for 30 min,
  then cooling); ready = SIP done + 60 + 180 + 30 + 120 min; raise when ready
  is later than the limit. Supporting: seed viability over 90 %, medium
  release still open on the destination's `media` source.

Detectors confirm with work items where ccgt does: a done instrument check
(PSIT02), a done maintenance item on the skid (PSIT04) and on the pump
(PSIT09). Only hands-on work types count (maintenance, inspection,
instrument check), so a batch-record review can't confirm a repair.
Detectors never read attention-item text.

**Robustness.** `robustness.py 10` regenerates the pack with 10 other seeds.
Every item was found on all 10, with no extra detections and the same
confidence each time. Raise times move with the noise: PSIT01 11:30–12:05,
PSIT07 11:40–12:05, PSIT08 10:10–10:55, PSIT10 11:20–12:15; the rest raise
at the same time on every seed (the events are steps or discrete stops).
Seeds only change the noise, so the size of the fault was also varied for
four detectors (5 seeds each, in a temporary copy of `generate.py`):

- Agitator wear (`AGIT_VIB_NOW`, 4.5 mm/s in the pack from 1.9): found every
  time at 2.7 mm/s (raised 13:10–13:45), 1 in 5 at 2.5.
- pCO₂ (`PCO2_NOW`, 148 mmHg in the pack from 92): found every time at 124
  (raised 12:40–12:55), the smallest the generator accepts, because its
  narrative needs the NOR crossing.
- WFI still (`STILL_OUT_LOW`, 2,700 L/h in the pack from 3,050): found every
  time at 2,900, 2 in 5 at 2,950.
- Viability (`VIAB_NOW`, 78.3 % in the pack from 84.0): found every time at
  79.0, 3 in 5 at 80.0, never at 81.0.

**Timing differences with the item narratives.** Worth aligning in
`generate.py` the next time it is regenerated:

- PSIT01: the text starts the divergence at 09:20. The detector sees it from
  10:45 (+0.25 mm/s) and raises at 11:50, once +0.5 mm/s has held 30 min.
- PSIT05: flagged at 11:50 in the text; the detector raises at 11:55, the
  first reading after cycle 3's load has ended.
- PSIT07: the text starts at 10:15; the rise is visible from about 10:45 and
  raises at 11:55. The detector projects the PAR at 15:02 (text 15:05).
- PSIT10: flagged at 10:00 in the text; raised at 11:45. At the last two
  hours' rate (−1.2 points/h) the 70 % criterion is reached around 21:06;
  the text says about 1 point/h and 22:10.
- PSIT11: raised at 13:25, as soon as PBR-3's SIP result is known, not 13:40.
  The fit gives 18:32 and a gap of 1 h 23 min (text 18:35 and about 80 min).
- PSIT02, 03, 04, 09 raise 15, 30, 15 and 50 minutes after their starts
  (third alternating jump, stall held 10 min, 15 min stopped, third stop
  confirmed by its restart).

**Data quirks and judgement calls.**

- PSIT07's conclusion names the cause the item deliberately doesn't: the
  headspace overlay cut from 120 to 30 slpm at 10:05. It is in the data and
  the rise starts 40 minutes later, so the explanation says so (medium
  confidence: no offline sample and the overlay hasn't been restored).
- PSIT08 has no work item for the vent valve. High confidence rests on the
  data alone: steam per litre went from +16.9 % to +2.6 % within 20 min of
  12:40, which scale or fouling can't do. The text says what cleared it is
  consistent with venting, not that venting was seen.
- PSIT10: the pack has no forecast series, so "forecast" is the batch's own
  straight-line trend over 08:00–09:30, labelled as such.
- PSIT11: the post-SIP step durations (60/180/30/120 min) are detector
  parameters, the planning values from RESEARCH/recipe, not read from the
  data. The explanation says so.
- PSIT03: steam is off the jacket at 13:10, so the recorded hold is
  12:10–13:05 (55 min) and F₀ from the 5-minute drain data is about 78 min
  (the text says 60 min and 74).
- PSIT04: the 2.5 bar trip happened between stored readings (last 2.18
  bar); the explanation projects it from the last 5-minute rise.
- PSIT09: the feed pumps' `media` source is MP-1, whose tank is empty until
  the 26-117 medium starts at 11:30. Supply is ruled out by comparing with
  PBR-1's feed pump instead of reading MP-1.
- PSIT01 rules out a shared cause against SBR-1's and PBR-2's drives, which
  run at other speeds; each is compared with its own first hour, not with
  PBR-1.

**Limits.** These are reference detectors. Thresholds come from RESEARCH.md
(ISO vibration alert 4.5 and alarm 7.1 mm/s, 121.1 °C SIP hold, 5 Pa room
minimum, pCO₂ NOR 120 and PAR 160 mmHg, breakthrough under 1.5 %, resin
life 100–300 cycles, 70 % harvest viability) and were checked against this
simulated data. Several use the first hour of the shift as the baseline, so
a fault already present at 08:00 would be hidden. On a real plant they are a
starting point, to be tuned on the site's own batch history.

## Validator warnings and why they're accepted

- **`[hierarchy]` process_cell instances have different child types.**
  ISA-88 process cells are containers: one holds bioreactors, one skids,
  one utilities. This is the "container holding a mix" case in spec §3.1.
- **`[properties]` extra categories `Cell Culture`, `Environmental`.**
  Cell culture state (VCD, viability, titer, O₂ demand, glucose, off-gas
  CO₂) is what an upstream operator groups by; `Environmental` covers
  cleanroom pressures, airflow and room temperature. 8 categories in total
  (the limit).
- **`[units]` mode `STANDBY` has no colour (HRV-1, VF-1).** Clean,
  released equipment waiting for its next batch is a normal and common
  batch-plant state. None of the seven coloured modes fits (`STOPPED`
  would read as a problem). It shows in a neutral colour; adding a colour
  is a one-line `src/` change if you want it.

## Known app behaviour this pack makes visible (no data change possible)

- **Related-asset boxes show a type's example instance, not the selected
  asset's own child.** Already noted for `pipeline`. It's more visible
  here: opening **PBR-2 → Related Assets** shows an "Agitation Module" box
  with **PBR-1's** 4.5 mm/s gearbox vibration, and a "pH Control" box with
  PBR-1's numbers, because rows are built type-to-type and each box shows
  the first instance of that type. In a demo that looks like PBR-2 has
  PSIT01's problem. Fixing it means resolving each row to the selected
  asset's own related instance in `getRelatedAssetsForType` (a `src/`
  change), so it was left alone.
- **CIP return edges were left out.** A supply edge plus a return edge
  made CIP-1 appear twice in a unit's Related Assets view, so the CIP
  layer draws one `CIP supply / return` edge per circuit. The WFI loop
  (tank → loop → tank) and the UF/DF recirculation loop keep both
  directions; they're between equipment modules, where the duplicate is
  less visible.
- **All Assets diagram initial zoom:** as with `ccgt` and `pipeline`, the
  diagram lays out all 96 nodes in headless Chromium but opens zoomed
  away from them until you zoom or fit.
