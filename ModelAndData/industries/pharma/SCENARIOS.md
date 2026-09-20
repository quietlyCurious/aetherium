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
