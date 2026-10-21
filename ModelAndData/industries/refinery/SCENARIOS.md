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

## Detectors and explanations (spec §14)

`explain.py` runs thirteen detectors, one per failure mode, on every asset
each applies to, and writes `public/data/refinery/explanations.json`. Each
one reads only the runtime files, never this sheet or `generate.py`'s
constants.

Because a line is a serial chain with one pace and no store except the
Aurelia Buffer, "expected" here is almost always one of three things:

- **the plan** — `line_target_rate`, for anything about rate (SIT02, SIT03);
- **the station next door on the `process_flow` layer** — the station it
  feeds or is fed by, with the fixed counter bias between the pair removed
  (SIT03, SIT07, SIT08, SIT09, SIT13);
- **the same station type on the other lines** — for condition and quality
  tags that have no plan value (SIT05 vibration, SIT07 reject rate, SIT13
  purity, SIT10 oscillation index).

Two detectors use a second instrument on the same equipment instead of any
peer at all: SIT06 compares the pressure transmitter with the local
mechanical gauge on the same vessel, and SIT04 closes a mass balance
(`level[i] = level[i−1] + (in − out) × 5 min ÷ 10.4 units per %`) on the
buffer's own flow meters, which agrees with the level transmitter to 0.0 %.

Lines in `changeover` are a normal state, not a fault. Every detector whose
subject is rate or stoppage skips them (`in_changeover`), and the two that
are *about* the changeover — SIT02 and SIT14 — require it.

| Item | Detector | Ran on | Fired on | Raised at | Confidence | Across 10 seeds |
|---|---|---|---|---|---|---|
| SIT02 | `refinery.busy_shift_confirmed` | 12 lines | F4 | 13:45 | high | 13:45 |
| SIT03 | `refinery.refinement_regulator_sluggish` | 6 Refinement stations | A3 · Refinement | 09:20 | high | 09:15–09:20 |
| SIT04 | `refinery.buffer_accumulation` | 6 Buffers | A4 · Buffer (root cause: A4 · Output) | 09:35 | high | 09:30–09:35 |
| SIT05 | `refinery.charger_bearing_wear` | 6 Power Charge drives | F2 · Power Charge | 11:50 | medium | 10:50–12:40 |
| SIT06 | `refinery.pressure_transmitter_fault` | 6 Stabilization stations | A5 · Stabilization | 09:45 | high | 09:45–09:55 |
| SIT07 | `refinery.inspection_rejects_upstream` | 6 Inspection gates | A1 · Inspection (root cause: A1 · Refinement) | 10:35 | high | 10:30–10:35 |
| SIT08 | `refinery.gross_vs_effective_output` | 6 Power Charge stations | F5 · Power Charge | 10:40 | high | 10:25–11:05 |
| SIT09 | `refinery.charger_fault_cascade` | 6 Power Charge stations | F3 · Power Charge | 11:45 | high | 11:45 |
| SIT10 | `refinery.manual_overcorrection` | 6 Power Charge stations | F1 · Power Charge | 12:45 | high | 12:45–12:50 |
| SIT11 | `refinery.transfer_hard_block` | 6 Transfer gates | F6 · Transfer | 13:25 | high | 13:25 |
| SIT12 | `refinery.charger_micro_stops` | 6 Power Charge stations | F2 · Power Charge | 13:45 | medium | 13:35–13:55 |
| SIT13 | `refinery.purity_drift_to_limit` | 6 Refinement stations | A6 · Refinement | 12:50 | high | 12:40–12:50 |
| SIT14 | `refinery.changeover_schedule_risk` | 12 lines | F4 | 12:00 | n/a | 12:00 |

**No detector fired anywhere else**, on the committed data or on any of the
ten regenerated copies. With 12 lines and 66 stations this was the main
tuning problem; what each detector had to be taught not to fire on is noted
below. Every computed confidence matches the item's `confidenceLevel`
except SIT14, which is a schedule clash rather than a diagnosis and so has
no level (`n/a` against the item's `high`) — the same as grid's GSIT12.

### What each detector checks

- **SIT02 `busy_shift_confirmed`** (archetype 02) — the positive case. A
  line that carried a planned product changeover on top of a full
  production shift: target rate goes to 0 with the unit state reading
  `changeover`, the window before it averaged ≥ 98.5 % of target with the
  30-minute mean never below 97 %, and then an explicit **sweep of all five
  stations** finds no exception — 30-minute mean rate inside ±4.5 % of
  target, no sample below 90 % of target, no more than two dips 3.5 % below
  target, stress under 28, and each station type's own tags in band
  (charger vibration against the other five chargers and its trend, purity,
  reject rate, Transfer blocking and starvation, buffer level). Instability,
  scrap and health are checked across the whole window as a fourth required
  check. The checks are the content: the sweep is what makes "nothing is
  wrong" worth reading, and the confidence section lists exactly what would
  change the verdict. Confidence is `high` because a routine Power Charge
  inspection (wk-002) closed on this line at 09:36 and raised nothing —
  somebody was at the machine. One supporting check honestly reads
  `nomatch`: the Grade B material staging closed 2 minutes past its window.
  *Does not fire on:* the other eleven lines, because none of them has a
  changeover; A2 (archetype 01, normal all day) would pass the sweep but has
  no planned product change to confirm.
- **SIT03 `refinement_regulator_sluggish`** (03) — station rate more than
  4 % behind the line target for 15 minutes while control effort is more
  than 4 points above its own first-hour baseline and climbing faster than
  3 points/h. Supporting: Inspection's deficit matches this station's to
  0.1/min (no store between them), the Buffer drained 14 points, upstream
  paced down with WIP up, and the rate recovered 105 % of the deficit within
  half an hour of wk-009 closing. *Does not fire on:* A4 · Refinement, which
  dips 4.3 % for one sample during the SIT04 drain but with control effort
  *below* baseline; A6 · Refinement (SIT13), whose effort steps up but whose
  rate never leaves target.
- **SIT04 `buffer_accumulation`** (04) — inflow minus outflow above
  +2/min for 20 minutes, level more than 12 points above its working level,
  the integrated net flow matching the level rise to within 15 % (it closes
  to 0.0 %), and the inflow median inside ±2.5/min of the hour before, which
  is what puts the cause downstream. Root cause asset is the buffer's
  `process_flow` target, A4 · Output. *Does not fire on:* A3 · Buffer, which
  also has a 20-minute net-inflow run (refilling after SIT03) but never
  climbs above its own working level.
- **SIT05 `charger_bearing_wear`** (05) — vibration more than 0.80 mm/s
  above the other five chargers (peer median plus this drive's own first-hour
  offset) for 30 minutes, rising faster than 0.25 mm/s/h with no 5-minute
  step above 0.35 mm/s, and rate, charge demand and motor current all at
  their own baselines on the median. The load check deliberately tolerates
  up to a fifth of its samples outside the band and names them: the SIT12
  micro-stops start at 13:30 on the same station, and the vibration keeps
  climbing through and between them. Confidence is `medium` — the drive
  inspection (wk-007) is open, not closed.
- **SIT06 `pressure_transmitter_fault`** (06) — transmitter minus local
  gauge more than 3 psi away from the pair's usual offset, with a 5-minute
  step on the transmitter above 3 psi while the gauge's largest step in the
  same window stays under 1.2 psi, and the gauge's whole range through the
  episode under 2.5 psi (it drifts slowly with the vessel, so a fixed
  morning baseline would not do). Flow, temperature, control effort,
  deviation and the next station down are all supporting, and the residual
  settling after wk-011 makes it `high`.
- **SIT07 `inspection_rejects_upstream`** (07) — reject rate above
  baseline + 1.5 points *and* above 1.8 × baseline for 15 minutes, with the
  gate's own calibration, measurement noise and false-reject rate inside
  band against the hour before, and the feeding Refinement's purity leaving
  its band 10–60 minutes *earlier* (20 minutes here). Root cause asset is
  A1 · Refinement. *Does not fire on:* A6 · Inspection, whose rejects rise
  0.7 points behind SIT13 — well under the 1.5-point alert.
- **SIT08 `gross_vs_effective_output`** (08) — the integral, not the
  instantaneous gap: over a rolling hour the station made 86 units more than
  the line shipped (bias-corrected against Output over the first two hours),
  the line gained 3.3 lots of WIP, the Output rate was no better than its own
  baseline *and no worse* than 3.5/min below it, and the cumulative
  gross-minus-shipped curve tracks the WIP curve at r = 0.98. The
  "no worse" floor is what separates this from a line that is simply broken.
  *Does not fire on:* F2 (whose Shaping dips briefly around 10:30, giving a
  smoothed rate gap as wide as F5's on some seeds, but no WIP build-up to go
  with it), F3 or F6 (WIP swings, but Output collapses, so the floor check
  catches them).
- **SIT09 `charger_fault_cascade`** (09) — rate below 30 % of the station's
  own hour-before baseline with motor current below 40 % (idle), every
  station downstream below 60 % of its baseline in the *same* sample, the
  deficit shrinking with distance (19 % → 47 % → 50 %), and the next sample
  back above 80 % — an interruption, not a stop. Supporting: Bulk Intake
  blocked rather than empty with material availability normal, and Transfer
  starved in the down sample then blocked in the recovery. *Does not fire
  on:* F6 · Power Charge during the SIT11 hold, because the sample after the
  collapse is still at zero.
- **SIT10 `manual_overcorrection`** (10) — oscillation index above 4.5 for
  10 minutes, at least four turning points alternating about the episode's
  mid-point with two cycles ≥ 6 % peak-to-peak, the largest cycle at least
  1.2 × the first (8.3 → 12.8 points), controller output correlated −1.00
  with the charge rate, and the station never below 90 % of rate. *Does not
  fire on:* F3 · Power Charge, whose charge rate also swings 11 points around
  the cascade — it is excluded by the rate floor (17.9/min) and by peaking at
  3.6 on the oscillation index, under the 4.5 alert.
- **SIT11 `transfer_hard_block`** (11) — gate rate under 1/min for at least
  10 minutes, motor current in the stopping sample above 1.3 × its running
  baseline (144.5 A against 95.2 A), then under 35 % of it for the rest of
  the stop, and every other station on the line at zero as well. Spike then
  idle is the obstruction signature; supporting checks are the 112 A restart
  surge and starvation appearing only at the restart. *Does not fire on:*
  F4 · Transfer during the changeover, which runs down to 11/min and idles
  its drive but never reaches zero and never spikes (and is skipped as a
  changeover anyway).
- **SIT12 `charger_micro_stops`** (12) — at least three samples more than
  3.5 % below the station's own two-hour local baseline inside a rolling
  hour, **in at least two separate runs**, each run no longer than 25
  minutes, with the samples between the runs averaging ≥ 98 % of baseline,
  the rate never below 50 % of baseline and the motor current never at idle,
  and a mean shortfall of at least 2 % (4.5 % here, about 226 units).
  Supporting: Transfer starvation up at the dips while blocking is not,
  material availability normal, charge demand and oscillation index higher in
  the dip samples. Confidence is `medium`: wk-008 is open. *Does not fire
  on:* F3 · Power Charge, whose deliberately reduced demand after the cascade
  is a 25-minute block of low rate — one run, not several, which is what the
  `min_runs` check is for.
- **SIT13 `purity_drift_to_limit`** (13) — purity 0.25 % below its own
  baseline and falling faster than 0.20 %/h, less than 0.40 % of margin left
  to the 98.50 % specification limit (about 44 minutes at the measured
  slope), the input characteristic index more than 4 above its baseline for
  30 minutes *and still there*, and the other five Refinements inside
  ±0.20 % of their own baseline. The persistent input shift is the required
  check that separates this from SIT07's purity dip on A1, which is a similar
  size but has no input shift behind it.
- **SIT14 `changeover_schedule_risk`** (14) — an open planned `CHANGEOVER`
  item on the line due within 2 hours, at least one of its `MATERIAL_STAGE` /
  `QUALITY_RELEASE` prerequisites still incomplete, and the request lead time
  plus the remaining prerequisite durations run back-to-back no longer fitting
  in the time left (60 + 40 + 20 min against the 2 h left at 12:00 — no slack
  at all). Supporting checks show what happened next: the two were worked in
  parallel instead, overlapping by 21 minutes, both closed before the
  changeover, and the line is now physically running down upstream-first.
  Conclusion label is "What's needed" and the confidence is `n/a`.

### Where the work list is read

Like pipeline and grid, several detectors confirm with work items rather than
a second sensor, and the explanations name the item and its closing time:
wk-002 (SIT02, a clean inspection — this is what makes SIT02 `high`), wk-007
(SIT05, still open → `medium`), wk-008 (SIT12, still open → `medium`),
wk-009 (SIT03), wk-010 (SIT04), wk-011 (SIT06), wk-012 (SIT07), wk-013
(SIT09), wk-014 (SIT11). For twelve of the thirteen detectors these are
**supporting** checks only, so the work list never decides whether a
detector fires.

SIT14 is the exception, and deliberately so: a changeover plan has no
telemetry until the changeover starts, so its required checks read the
`CHANGEOVER` item's due time and its prerequisites' `estimatedDurationMinutes`
from the work list — the same shape as grid's `clearance_at_risk`. The
60-minute cross-team request lead is a planning value in `params`, not a
measurement, and the explanation says so. No detector reads an attention
item's own signal, detail text or evidence.

### Two attention items on one asset

Refinery is the only pack where two items share an asset: SIT05 and SIT12 are
both on `FERRUM_F2_POWER_CHARGE`, and SIT02 and SIT14 are both on
`FERRUM_F4`. `build.run_pack` attaches the first detector that fired on an
asset to every item on that asset, so `explain.py` has a small `hand_over`
helper: when the detector that fired first is asked to explain the *other*
item on its asset, it delegates to that item's own detector and corrects the
two fields the runner fills in afterwards (`detectorId` and `detectedAt`).
The mapping is by attention-item id (`HANDOVER`), which is the same
attach-the-right-explanation step the runner does by asset id — it never
decides whether a detector fires. All four detectors run and fire on their
own, so the run report still shows where each of them found something.

### Robustness and detection floors

`python3 ModelAndData/industries/refinery/robustness.py 10` regenerates the
pack with ten other seeds and reruns every detector on each copy. **All
thirteen items were found 10/10, with no extra detections**, and the computed
confidence was the same every time. Raise times move with the noise (last
column of the table above); SIT05 moves most, 10:50–12:40, because it raises
when a slow trend crosses a fixed level.

Other seeds vary the noise only, not the size or timing of a fault, so the
fault size was also varied for four detectors (5 seeds each, scaling the
scenario profile in a temporary copy of `generate.py`; no extra detections at
any size):

- **Charger bearing wear** (`SIT05_VIBRATION`, +1.96 mm/s over the shift):
  found 5/5 at 70 % of the rise (+1.37 mm/s), 1/5 at 55 % (+1.08 mm/s), never
  at 45 %. The binding threshold is +0.80 mm/s above the other chargers held
  for 30 minutes with a ≥ 0.25 mm/s/h slope, so a smaller fault is still too
  young to raise by 14:05.
- **Buffer accumulation** (`SIT04_LEVEL`, +28.4 points): found 5/5 at 60 %
  (+17 points), never at 45 % (+13 points). The floor is the 12-point rise
  above working level plus 20 minutes of net inflow.
- **Purity drift** (`SIT13_PURITY`, −0.64 %): found 5/5 at 65 % (−0.42 %),
  never at 50 % (−0.32 %). Below that the margin to the 98.50 % limit never
  closes to the 0.40 % the detector asks for.
- **Micro-stops** (`SIT12_LOSS`, 4.2 % mean loss): found 5/5 at 100 %, 3/5 at
  80 % (3.4 %), 2/5 at 65 % (2.7 %), never at 50 % (2.1 %). The 2.0 % mean
  shortfall and the three deep samples are what bind.

These are **reference detectors** (spec §14.8). Their thresholds were set
against this pack's simulated data and sanity-checked for false positives on
the eleven other lines and ten regenerated copies; they are a starting point
to tune on a customer's own history, not validated settings.

### Differences from the item narratives

The detectors raise from the data, so some times differ from the hand-written
item text. None of these are errors in either place:

- **SIT03** drifts from 08:45 in the text; the detector sees it at 08:50
  (2 % behind target) and raises at 09:20, once 4 % has held 15 minutes.
- **SIT05** starts at 09:00 in the text, with evidence from 08:50. The
  detector raises at 11:50, when the excess vibration has held above
  +0.80 mm/s for 30 minutes; it marks the divergence from 10:15 (+0.40 mm/s).
- **SIT07** is flagged at 10:15 in the text; the detector raises at 10:35,
  after 15 minutes above its alert level.
- **SIT08** runs 10:00–11:35 in the text. The detector needs a full hour of
  gross-against-shipped to see 86 units through the counters' own noise, so
  it raises at 10:40.
- **SIT11** blocks at 13:20; the detector raises at 13:25, the second sample
  at zero (one sample at zero could be a counter).
- **SIT12** starts at 13:10 in the text, where the per-sample losses are
  0.4–3 %. The detector's first *deep* sample (3.5 % below baseline) is
  13:30 and it raises at 13:45; its conclusion therefore says "since 13:30"
  and measures 4.5 % rather than the text's 4.2 %, which is the mean from
  13:10.
- **SIT13** is flagged at 12:48 in the text and the detector raises at 12:50,
  the first sample where the margin to the limit is inside 0.40 %.
- **SIT02** raises at 13:45, the last production sample before the
  changeover, because the sweep covers the whole production window.

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
