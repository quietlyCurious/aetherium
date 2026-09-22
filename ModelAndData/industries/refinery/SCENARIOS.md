# Refinery (Aurelia & Ferrum) — scenario sheet (28 Aug 2026)

The process is fictional by design (see `RESEARCH.md`). "Now" is **14:05**;
the timeline is 08:00–14:05 in 5-minute steps (74 points). Each scenario's
numbers are constants at the top of `generate.py` (`SIT03_…` to `SIT13_…`,
`F4_…`). Evidence values in `attention-items.json` are read back from the
generated series. The attention-item text is verbatim from the hand-built
pack, and a block of checks at the end of `generate.py` fails the run if the
data stops matching a number that text quotes.

All numbers below are from the committed data (seed 20260828). Other seeds
change the noise, not the timing or size of any scenario.

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:05 |
|---|---|---|---|
| SIT02 | 02 Busy-but-normal | F4 (line) | resolved, low |
| SIT03 | 03 Quiet drift | A3 · Refinement (station) | resolved |
| SIT04 | 04 Accumulation | A4 · Buffer (station); cause at A4 · Output | resolved |
| SIT05 | 05 Component degradation | F2 · Power Charge (station) | **open**: investigate |
| SIT06 | 06 Signal noise (instrument) | A5 · Stabilization (station) | resolved, low |
| SIT07 | 07 Ghost signal | A1 · Inspection (station); cause at A1 · Refinement | resolved |
| SIT08 | 08 Throughput illusion | F5 · Power Charge (station) | resolved |
| SIT09 | 09 Cascade failure | F3 · Power Charge (station) | resolved, high |
| SIT10 | 10 Overcorrection loop | F1 · Power Charge (station) | resolved, high |
| SIT11 | 11 Hard block | F6 · Transfer (station) | resolved, high, **new** (17 min) |
| SIT12 | 12 Recurring micro-events | F2 · Power Charge (station) | **open**: investigate |
| SIT13 | 13 Quality drift | A6 · Refinement (station) | resolved, **new** (23 min) |
| SIT14 | 14 Plan / compliance at risk | F4 (line) | **recovering** |

- 13 items covering 13 archetypes (all except 01), on 11 of the 12 lines
  (all but A2), 6 station types plus `line`, on 2 levels. Two items sit on
  a non-leaf asset (F4).
- Outcomes: 2 open, 1 recovering, 10 resolved. There are three `high`
  items and no `act` item (see the validator warnings at the end).
- **Archetype 01 (normal):** A2 all shift, plus every station and key not
  listed under a scenario below. A future detector should stay quiet there.
- **F4 planned changeover** (Product A → C, unit state `changeover` since
  13:50) isn't an attention item, but it's in the data. From 13:50 the line
  target is 0, stations run down upstream first (Bulk Intake 95 → 6/min,
  Output 118 → 13/min by 14:05), and line instability climbs 15 → 44, so
  health falls to 88.7 and Ferrum's instability roll-up to 44. Power Charge
  charge rate eases 50 → 38 %, and energy per unit rises 4.2 → 5.4 as fixed
  load spreads over few units. It's excluded from availability and
  performance because it's planned.

## Scenarios

### SIT02 — F4 busy but normal (02)

- **Asset:** `FERRUM_F4`. **Primary:** `line_throughput`. Evidence is status
  codes (1 = planned work on track), not series values.
- **Data:** nothing abnormal on F4 before its 13:50 changeover. The four
  planned tasks (wk-001…003 done on time; wk-004 changeover) are the story.

### SIT03 — A3 Refinement regulator sluggish (03)

- **Asset:** `AURELIA_A3_REFINEMENT`. **Primary:** `throughput_per_min`.
- **Story:** throughput drifts from 120.4 (08:20) to 110.9/min at 09:25
  while `control_effort_pct` climbs 50 → 61.8 %. The regulator is adjusted
  09:14–09:24; it's back to 118.3 at 09:35 and 120.5 at 09:50.
- **Related:** Inspection is starved by the full gap (111–118/min).
  Intake and Stabilization pace down by half the gap, so A3 `total_wip`
  rises 43 → 49 lots and `flow_efficiency` dips to 97.3. The **Buffer
  absorbs**: level 44 → 27 %, starvation risk up. Output only dips
  2–5/min, then the buffer refills by about 10:30.
- **Secondary:** Refinement process variability +0.5, stress +4, line
  instability +0.6.
- **Times:** drift from 08:45, lowest 09:25, resolved 09:40. **Work:**
  wk-009.

### SIT04 — A4 Buffer accumulation from an Output restriction (04)

- **Asset:** `AURELIA_A4_BUFFER`. **Primary:** `buffer_level`. **Root cause:**
  `AURELIA_A4_OUTPUT`.
- **Story:** inflow stays about 120/min while Output falls to 109–115/min
  from 09:15. Level 42.6 % (09:00) → 70.3 % (09:55) → peak about 71 %
  (10:05–10:10). The restriction clears at 10:05, Output runs 123–126/min
  while upstream is paced −5/min (10:10–10:40), and the level drains to
  42.8 % at 10:40. Outflow is back-computed from the level by mass balance,
  so it always closes.
- **Secondary:** saturation risk 7 → 18.8; time in buffer 3.7 → 6.2 min;
  turnover down; Output on-time rate 98.5 → 95.6 %; Output and Buffer
  stress up; line throughput (= Output) dips, so `line_performance` dips
  slightly.
- **Times:** 09:14–10:05; resolved 10:28. **Work:** wk-010.

### SIT05 — F2 Power Charge bearing wear (05, open)

- **Asset:** `FERRUM_F2_POWER_CHARGE`. **Primary:** `vibration_mms`.
- **Story:** vibration rises from 2.47 (08:50) to 4.38 mm/s (13:55),
  accelerating, **at unchanged load**: throughput stays about 125/min, motor
  current 97–102 A and charge rate about 50 % (until SIT12 starts at 13:10).
- **Secondary:** bearing temperature about 61 → 67–69 °C; energy per unit
  +0.12; stress +3. F2 health index falls 99.2 → 97.7 (0.55 per mm/s of
  excess vibration).
- **Times:** start 09:00 (evidence from 08:50); open. **Work:** wk-007 (drive
  inspection, started 14:00, not done).

### SIT06 — A5 pressure transmitter loose connection (06)

- **Asset:** `AURELIA_A5_STABILIZATION`. **Primary:** `process_pressure_psi`.
- **Story:** an error on the transmitter only, 09:40–10:00: +1.8, +5.2,
  −1.2, a 95.1 psi reading at 09:55, then +1.2. Reseated 10:04.
- **What doesn't move (the point):** local gauge 79.1–80.1 psi, flow
  meter 119.7–121.7/min, temperature, control effort and throughput. No
  other asset reacts.
- **Times:** resolved 10:18. **Work:** wk-011.

### SIT07 — A1 Inspection rejects, cause upstream at Refinement (07)

- **Asset:** `AURELIA_A1_INSPECTION`. **Primary:** `reject_rate_pct`.
  **Root cause:** `AURELIA_A1_REFINEMENT` (`process_flow` edge).
- **Root cause first:** Refinement purity falls from 09:55 (99.3 → 98.8 %
  by 10:30), with defect rate, yield and consistency following. Rejects are
  still 1.8 % at 10:05, then 3.5 % (10:15), 6.6 % (10:40), 5.2 % (10:55)
  and 1.8 % (11:20) after the 10:43 adjustment.
- **Secondary:** pass rate = 100 − rejects; first-pass yield 97.6 → 92.4 %;
  line scrap 0.85 → 1.32 (10 % of extra rejects are scrapped); Output
  final defect rate up slightly. **Calibration stays at 99.6–99.7**, which
  rules out the gauge.
- **Times:** resolved 11:08. **Work:** wk-012.

### SIT08 — F5 throughput illusion (08)

- **Asset:** `FERRUM_F5_POWER_CHARGE`. **Primary:** `throughput_per_min`.
- **Story:** from 10:00, Power Charge (and the Bulk Intake feeding it) is
  pushed to 124–125/min, but Shaping sustains only about 122.6/min, so
  Shaping, Transfer and Output hold about 122–123. The gross rate looks
  fine, while WIP climbs 39 → 47.5 lots and Transfer blocking time rises
  0.8 → 2.2. Shaping's defect rate (0.9 → 1.4) and rework rise, and line
  scrap goes 0.69 → 0.90. At 11:35 demand is cut about 4 % (125.1 at 11:00
  → 120.6 at 11:45). WIP drains by 12:30, and flow efficiency goes 98.3 →
  101.2 while it drains.
- **Times:** 10:00–11:35; resolved 11:35.

### SIT09 — F3 Power Charge fault cascades downstream (09)

- **Asset:** `FERRUM_F3_POWER_CHARGE`. **Primary:** `throughput_per_min`.
- **Story:** the first interruption is at 11:42, so the first sample to
  show it is 11:45: 17.9/min, with motor current at idle and a controller
  output spike. At the same sample Bulk Intake is blocked (about 54),
  Shaping is starved (24) and Transfer is emptying (58), with starvation
  time 2.6. At 11:50 there's a brief recovery: Shaping catches up at 127
  while Transfer accumulates (121, blocking time 1.9) and WIP swings −3 →
  +4. Demand is reduced 11:55–12:15 (about 118 on every station), repaired
  12:12, and back to 125 at 12:20.
- **Headline:** F3 instability peaks at 13.1 and health dips to 96.7.
  Availability loses the 11:45 sample (−0.2), which shows in F3's OEE and
  in Ferrum's roll-ups.
- **Timing aligned with the narrative:** in the converted data the drop
  sat at 11:40, before the 11:42 event. The evidence labels were moved one
  sample later: 11:45 "Power fault — first interruption", 11:50 "Brief
  recovery", 11:40 now blank.
- **Times:** resolved 12:20. **Work:** wk-013.

### SIT10 — F1 manual over-correction (10)

- **Asset:** `FERRUM_F1_POWER_CHARGE`. **Primary:** `charge_rate`.
- **Story:** charge rate 50.3 → 52.1 → 43.8 → 56.6 → 45.0 → 47.3 → 50.5 %
  (12:35–13:00), stable by 13:10. Controller output mirrors it (38.6–59.1 %),
  oscillation index 2 → 5.6, and throughput swings 123–128/min, with
  Shaping following at 70 % of the swing.
- **Headline:** F1 instability peaks at 12.5 and health dips to 96.3.
- **Times:** resolved 13:10.

### SIT11 — F6 Transfer physically blocked (11)

- **Asset:** `FERRUM_F6_TRANSFER`. **Primary:** `transfer_rate_per_min`.
- **Story:** the Transfer rate is 0 at 13:20–13:35 (jam 13:20, cleared
  13:38), then 35.7 at 13:40, 102.8 at 13:45 and 120.4 at 13:50. Motor
  current spikes to 144.5 A at the jam, idles at about 19 A through the
  hold, and surges to 112 A on restart. The controlled hold stops the whole
  line: Bulk Intake, Power Charge and Shaping go 45 → 0 → 60 → 112, and
  Output and line throughput go 20 → 0 → 30 → 100.
- **Headline:** F6 rolling availability 99.0 → 97.4 %, OEE 97.6 → 96.0 %
  (and it stays there: it's a 24-hour figure). Ferrum throughput is about
  612–616/min during the hold. Transfer isn't "blocked" or "starved" during
  the hold, because it's the station that's down; starvation rises only at
  the restart.
- **Timing aligned with the narrative:** the converted data's evidence
  array (13:40 = 59, 13:45 = 104, 13:50 = 125) and its value strings (13:40
  = 0) disagreed. The data now follows the narrative (cleared 13:38), and
  the labels moved one sample earlier: 13:40 "Clearing", 13:45
  "Recovering", and 13:50 "Back to baseline" (new).
- **Times:** resolved 13:48. **Work:** wk-014.

### SIT12 — F2 recurring micro-stops (12, open)

- **Asset:** `FERRUM_F2_POWER_CHARGE`. **Primary:** `throughput_per_min`.
- **Story:** from 13:10 each 5-minute sample loses a fraction of its rate
  (0.4–6 %, with a cluster of stops at 13:45 costing 20 %). That averages
  4.2 % over 13:10–14:05, the "estimated 4.2% production loss". With no
  store on a Ferrum line, every F2 station loses the same fraction.
- **Secondary:** Transfer starvation time follows each loss (up to 2.5 at
  13:45); charge rate peaks with the stops ("strongest at the highest
  charge-demand periods"); oscillation index and line instability are
  elevated (1.9–3.1). Vibration keeps climbing from SIT05, which is the
  "possibly connected" note in the text.
- **Times:** start 13:10; open. **Work:** wk-008 (not done, due 14:20).
- **Deliberately not reproduced:** the converted data had one sample at
  12.6/min. A seconds-long micro-stop can't take a 5-minute rate to 10 %,
  so the 13:45 dip is now about 101/min.

### SIT13 — A6 purity drift toward limit (13)

- **Asset:** `AURELIA_A6_REFINEMENT`. **Primary:** `purity_pct`.
- **Root cause first:** the input characteristic index rises from 11:30
  (50.7 → 58.9 by 13:05) and **stays shifted**.
- **Story:** purity 99.28 % (12:00) → 99.02 (12:30) → 98.88 (12:50) →
  98.65 (13:05, lowest). A validated Refinement adjustment at 13:08 (control
  effort steps +3 %, held) brings it to 98.90 (13:20), 99.29 (13:35) and
  99.27 (13:50).
- **Secondary:** Refinement defect rate up; A6 Inspection rejects 1.8 →
  2.9 % about 10 min later; Output quality score −0.4; line health dips
  slightly.
- **Times:** resolved 13:42.

### SIT14 — F4 changeover prerequisites at risk (14)

- **Asset:** `FERRUM_F4`. **Primary:** `line_throughput`; evidence is
  status codes (0 = pending, 1 = moving or done).
- **Data:** the risk lives in the work items (wk-004 to wk-006: staging
  done 13:52, release 13:31). The line data shows the changeover itself
  from 13:50 (see Coverage). Recovering since 12:00.

## What changed from the converted data (for reviewers)

- Every series is regenerated: AR(1) drift around per-asset setpoints, with
  levels matched to the converted data. Instrument tags that were flat
  outside incidents (Transfer motor current and gate rate, for example) now
  have normal noise.
- Stations on a line now share a line pace, and `line_throughput` equals
  the Output station's rate. Before, they were independent: line
  throughput had lag-1 autocorrelation ≈ 0 and didn't react to a full
  Transfer block.
- `line_oee` now **equals** availability × performance × quality factor,
  as its derivation note says. The old values were up to 0.9 points above
  the product, so Aurelia's OEE reads about 98.2 instead of 98.6. Line
  KPIs are rolling 24-hour figures (RESEARCH §4).
- `throughput_per_min` range lower bound 0.9 → 0, because a blocked line
  reads 0. No other metadata changed.

## Validator warnings and why they're accepted

`python3 ModelAndData/tools/validate_industry_pack.py refinery` → 0 errors,
9 warnings (the same 9 as the converted pack). None can be fixed without
changing something that must stay stable:

- **`[hierarchy]` type `line` instances have different child types.**
  Aurelia and Ferrum lines have different station sequences, but one `line`
  type is kept because saved settings are keyed by it. It's the "container
  holding a mix" case in spec §3.1.
- **`[properties]` 6 types have more than about 8 properties** (line 11,
  stabilization 11, refinement 10, buffer 10, inspection 9, power_charge 9).
  Every asset must keep its property keys.
- **`[attention]` SIT02 has 2 evidence points (spec: 5–8).** Its evidence
  points and text are kept verbatim. It's a busy-but-normal record with
  only a start and an end.
- **`[scenarios]` no `act` item.** Attention states are part of the stable
  item set; the three `high` items are all resolved.
