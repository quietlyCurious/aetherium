# Combined cycle — scenario sheet (Halcyon Point, 28 Aug 2026)

"Now" is **14:05**. The timeline is 08:00–14:05 at 5-minute steps. Each
scenario's constants live at the top of `generate.py`, and the evidence
points and quoted numbers in `attention-items.json` are read back from
the generated series, so this sheet, the data and the narrative agree.

**The day:**

- **Weather:** a hot, drying late-August day. Ambient climbs from 78 °F
  to 95 °F and wet bulb from 70.6 °F to 75.6 °F.
- **Load:** the block is on AGC. The dispatch target is 650 MW net until
  09:50, then ramps to 705 MW by 10:25 for the afternoon peak. By 14:05
  both CTGs are close to their hot-day capability.
- **Everything else** in this file happens on top of that.

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:05 |
|---|---|---|---|
| HSIT01 | 05 Component degradation | HRSG-2 · Feedwater System · BFP-A · Pump Bearings (component) | **open**: investigate |
| HSIT02 | 03 Quiet drift | CTG-2 · Compressor (system) | **recovering** |
| HSIT03 | 06 Signal noise (instrument) | CTG-2 · Turbine Section (system, non-leaf) | resolved, high |
| HSIT04 | 07 Ghost signal | STG-1 · Condenser (system, non-leaf); cause on Common Plant · CT cell 6 | resolved |
| HSIT05 | 10 Overcorrection loop | HRSG-1 · HP Section · HP Drum (equipment, non-leaf) | **open**: act, high |
| HSIT06 | 09 Cascade failure | Fuel Gas Yard · Performance Heater (system) | resolved, high |
| HSIT07 | 08 Throughput illusion | Halcyon Point (site, above unit level, `unitId: null`) | **open**: investigate |
| HSIT08 | 13 Quality drift (emissions) | HRSG-1 · SCR / Emissions (system, non-leaf) | resolved |
| HSIT09 | 12 Recurring micro-events | CTG-1 · Combustion System (system, non-leaf) | **open**: investigate |
| HSIT10 | 11 Hard block | HRSG-2 · SCR / Emissions · Ammonia Skid (equipment) | resolved, high |
| HSIT11 | 14 Compliance at risk | HRSG-2 · SCR / Emissions · Stack CEMS (equipment) | **open**: act, **new** (20 min) |

**Totals:**

- 11 items covering 11 different archetypes.
- 6 units (CTG-1, CTG-2, HRSG-1, HRSG-2, STG-1, Fuel Gas Yard) plus the
  site; the cooling tower is the root cause behind HSIT04.
- 11 asset types, across 4 levels (site, system, equipment,
  component). Units carry them through their tiles.
- Outcomes: 5 open, 1 recovering, 5 resolved.
- Archetype 01 (normal) is the rest of the plant: Switchyard, CW pumps,
  both generators, GSUs.
- Archetype 02 (busy-but-normal) is the planned work list (rounds,
  chemistry, spare CW pump lubrication, DGA review, a transmitter
  calibration).

**Unit tiles at 14:05:**

- `attention`: CTG-1 (since 11:20), HRSG-1 (since 13:20), HRSG-2 (since
  09:30).
- `running`: everything else.

## Scenarios

### HSIT01 — HRSG-2 BFP-A bearing degradation (05)

- **Asset:** `HALCYON_B1_HRSG2_FW_BFPA_BRG`. **Primary:**
  `pump_bearing_temp_f`.
- **Story:** from 09:30 the bearings run hotter at unchanged flow (about
  1,410 gpm): 161 °F → 191 °F by 14:05. The identical HRSG-1 BFP-A reads
  166 °F.
- **Secondary signals:**
  - vibration 0.127 → 0.264 in/s, accelerating (past the ≈ 0.18 in/s ISO
    alert level)
  - motor current +7 A
  - motor winding temperature follows the current
- **Related:** BFP-B, the standby on the same `feedwater` edges, is ready.
  An unplanned trip would upset HRSG-2 drum levels.
- **Ruled out:** a load change (flow and speed are steady), and a sensor
  fault (two independent signals agree).
- **Work items:** wk-h14 (vibration spectrum, oil sample, prepare a swap).
- **Why it's realistic:** RESEARCH §5 #12 [19].

### HSIT02 — CTG-2 compressor fouling, part-recovered by online wash (03)

- **Asset:** `HALCYON_B1_CTG2_COMP`. **Primary:**
  `compressor_efficiency_pct`.
- **Timeline:**
  - efficiency 88.29% at 08:00 → 87.32% at 11:25 (CTG-1 steady at about
    88.6%)
  - online wash 11:30–12:00
  - 88.26% at 12:30, 87.94% at 14:05 (the loss starts again slowly)
- **Secondary signals:** on `CTG-2`, corrected output 99.2 → 97.4% → 98.5%
  and heat rate about 1.4% above CTG-1 at 11:25. Also lower CPD, and
  exhaust temperature about 3 °F higher.
- **The "quiet" part:** AGC kept net output on target by loading CTG-2 a
  little harder, so no alarm fired.
- **Outcome:** recovering. The remaining loss needs an offline crank wash
  at the next outage [25][26].
- **Work items:** wk-h09 (the wash, done).

### HSIT03 — CTG-2 exhaust thermocouple TC-14 (06)

- **Asset:** `HALCYON_B1_CTG2_TURB`. **Primary:** `exhaust_temp_spread_f`.
- **Timeline:** 10:05–11:00 the spread alternates between about 36 °F and
  up to 111 °F with no trend. TC-14 was rejected at 11:05, and the spread
  is back to 31 °F.
- **The point:** nothing else confirms it. Combustion dynamics, NOx,
  wheelspace and exhaust average stay flat, and the low reader never moves
  around the annulus [11]. Severity is `high` because a real spread that
  large would be a trip precursor.
- **Work items:** wk-h08 (done).

### HSIT04 — Cooling tower fan trip shows up at the condenser (07)

- **Asset:** `HALCYON_B1_STG1_COND`. **Primary:**
  `condenser_backpressure_inhga`.
- **Root cause:** `HALCYON_CP_CW_CT_CELL6`, reached over the
  `cooling_water` layer (CT → CW Pump Station → CW pumps → Condenser).
- **Timeline:**
  - 10:50 cell 6 fan motor trips (fan power 0 kW, gearbox vibration ~0,
    cell outlet temperature near the hot-water temperature)
  - tower approach +2 °F; CW supply 81.6 → 84.5 °F
  - backpressure 2.54 → 2.75 inHgA by 11:35
  - 11:40 fan reset
  - backpressure back on its wet-bulb trend (2.61) by 12:20
- **Ruled out:** condenser air in-leakage and TTD, both unchanged.
- **Work items:** wk-h10 (done).

### HSIT05 — HRSG-1 HP drum level oscillation (10)

- **Asset:** `HALCYON_B1_HRSG1_HP_DRUM`. **Primary:** `drum_level_in`.
- **Timeline:**
  - 13:10 the HP steam flow transmitter is valved out for its planned
    calibration (wk-h06), so level control drops to single-element
  - 13:20 the oscillation starts at ±1.5 in
  - manual feedwater valve moves at 13:25 and 13:45 land out of phase
  - +6.5 / −6.7 in by 14:05
- **Secondary signals:**
  - `…_HP_DRUM_FCV` valve position and HP feedwater flow oscillate in
    antiphase to the level
  - BFP-A flow on the same `feedwater` edges follows
  - HP steam flow is steady
- **Open** (`act`, high): a trip at ±8 in would take HRSG-1 and CTG-1 off.
  The text gives the loop interaction as the hypothesis, not a confirmed
  cause.
- **Work items:** wk-h12 (restore three-element control, urgent), wk-h06.

### HSIT06 — Fuel gas heater trip cascades through the block (09)

- **Asset:** `HALCYON_CP_FG_HTR`. **Primary:** `fuel_gas_temp_f`.
- **Timeline:**
  - 08:35 heating-water flow drops to 0 (positioner air line failure)
  - fuel temperature 365 → 109 °F by 09:10
  - Modified Wobbe Index 42.5 → 51.2, outside the ±5% band
  - 08:40 both CTGs run back on the `fuel_gas` edges, to about 183 MW each
  - HRSG HP steam falls 533 → 453 klb/h (`exhaust_gas` edges)
  - STG-1 241 → 207 MW with a 10–15 min lag (`steam`)
  - plant net 649 → 553 MW, against a 650 MW target
  - 09:15 heating water restored; CTGs released at 09:45
- **Secondary signals:**
  - combustion dynamics about 2 psi on both CTGs
  - HRSG-2 stack NOx briefly 2.1 ppm (1-hour average under 2.0)
  - plant heat rate spikes to about 6,580 Btu/kWh
  - EAF (24 h) falls to 98.9% on the CTGs and 99.0% on the STG
- **Work items:** wk-h07 (done).

### HSIT07 — On target, but burning more fuel (08)

- **Asset:** `HALCYON` (site). **Primary:** `net_heat_rate_btu_kwh`.
- **Ground truth:** from 11:45 the STG-1 HP bypass valve passes a growing
  share of HP steam to the condenser, 3.4% by 14:05, while still reading
  0% open.
- **What shows:**
  - net output stays on the 705 MW target
  - net heat rate 6,390 → 6,462 Btu/kWh (+1.1%), while the CTGs' own heat
    rates rise only 0.4% (ambient)
  - STG-1 MW per GT MW 0.550 → 0.538
  - bypass downstream temperature 232 → 779 °F
  - condenser heat load slightly up
- **Open** (`investigate`): the text names a passing steam-side valve as
  the leading hypothesis only.
- **Why it's realistic:** RESEARCH §5 #15 [27][17].

### HSIT08 — HRSG-1 ammonia slip drifting toward its limit (13)

- **Asset:** `HALCYON_B1_HRSG1_SCR`. **Primary:** `ammonia_slip_ppm`.
- **Story:** night shift lowered the NOx trim setpoint 1.5 → 1.0 ppm at
  02:10. The NH₃/NOx molar ratio climbs 0.89 → 0.95 through the morning.
  Stack NOx looks excellent (0.83 ppm), but slip rises nonlinearly from
  2.3 to 4.1 ppm (limit 5).
- **Timeline:** setpoint restored at 11:15; slip is 1.8 ppm by 12:00.
- **Comparison:** HRSG-2 runs at about 1.9 ppm all morning.
- **Why it's realistic:** RESEARCH §5 #13 [2].

### HSIT09 — CTG-1 combustion dynamics excursions (12)

- **Asset:** `HALCYON_B1_CTG1_COMB`. **Primary:**
  `combustion_dynamics_psi`.
- **What shows:**
  - six one-interval hot-tone excursions at 11:20, 12:15, 12:50, 13:20,
    13:40 and 13:55 (2.66 → 3.37 psi)
  - gaps shrinking from 55 to 15 minutes
  - baseline creeping from 1.04 to about 1.3 psi as compressor inlet
    temperature climbs
  - a small NOx bump each time
  - CTG-2 and fuel quality steady
- **Open** (`investigate`): the cause (tuning margin at high ambient) is
  given as a possibility only.

### HSIT10 — HRSG-2 ammonia forwarding pump trip (11)

- **Asset:** `HALCYON_B1_HRSG2_SCR_NH3`. **Primary:** `ammonia_flow_lb_h`.
- **Timeline:**
  - 12:20 pump A trips and pump B fails to auto-start; flow falls to 0
  - NOx removal 83% → ~0 after a short lag (NH₃ stored on the catalyst)
  - stack NOx peaks at 8.6 ppm on the `chemical_dosing` → `exhaust_gas`
    edges to the CEMS
  - 12:35 pump B started locally; NOx back under 2 ppm by 12:45
- **Consequence:** the 12:00–13:00 average is 2.9 ppm, one reportable
  excess-emission hour.
- **Work items:** wk-h11 (done).

### HSIT11 — HRSG-2 CEMS calibration deadline (14)

- **Asset:** `HALCYON_B1_HRSG2_SCR_CEMS`. **Primary:**
  `hours_since_cal_h`.
- **Story:** the 06:00 auto-calibration aborted on low cal gas pressure,
  and the last good calibration was 12:30 yesterday. Under 40 CFR 75 App. B
  the data is valid for 26 hours, until 14:30 [31]. That leaves 25 minutes
  against ~50 minutes of work.
- **Found:** 13:45 in the DAHS review (the "new" item, 20 minutes old).
- **Work items:** wk-h13 (urgent, due 14:30).

## Detectors and explanations (spec §14)

`explain.py` runs eleven detectors, one per failure mode, on every asset each
applies to, and writes `public/data/ccgt/explanations.json`. Each one reads
only the runtime files, never this sheet or `generate.py`'s constants.
Almost everything on a 2x1 block comes in pairs, so "expected" here usually
means "what the sister unit does at the same moment" (CTG-1 against CTG-2,
HRSG-1 against HRSG-2, the running BFP against the other HRSG's). The
condenser uses physics instead: backpressure is split into the part the
extra tower approach explains (Antoine saturation curve), with no fitted
coefficients.

| Item | Detector | Ran on | Fired on | Raised at | Confidence |
|---|---|---|---|---|---|
| HSIT01 | `ccgt.bfp_bearing_wear` | 4 pump bearing sets | HRSG-2 BFP-A | 11:25 | medium |
| HSIT02 | `ccgt.compressor_fouling` | 2 GT compressors | CTG-2 | 10:10 | high |
| HSIT03 | `ccgt.exhaust_tc_fault` | 2 GT turbine sections | CTG-2 | 10:15 | high |
| HSIT04 | `ccgt.tower_cooling_loss` | 1 condenser | STG-1 condenser (root cause: CT cell 6) | 11:05 | high |
| HSIT05 | `ccgt.drum_level_oscillation` | 6 HRSG drums | HRSG-1 HP drum | 13:35 | medium |
| HSIT06 | `ccgt.fuel_heater_cascade` | 1 fuel gas heater | Performance heater | 08:45 | high |
| HSIT07 | `ccgt.hidden_steam_loss` | 1 plant | Halcyon Point | 13:05 | medium |
| HSIT08 | `ccgt.scr_overfeed_slip` | 2 SCR systems | HRSG-1 SCR | 09:45 | high |
| HSIT09 | `ccgt.dynamics_excursions` | 2 DLN combustors | CTG-1 | 12:50 | medium |
| HSIT10 | `ccgt.ammonia_supply_loss` | 2 ammonia skids | HRSG-2 skid | 12:25 | high |
| HSIT11 | `ccgt.cems_calibration_deadline` | 2 CEMS analyzers | HRSG-2 CEMS | 12:35 | n/a |

No detector fired anywhere else. Every computed confidence matches the
item's `confidenceLevel`. The standby pumps (both BFP-Bs) are candidates
for the BFP detector but never fire: a pump that isn't running has no
residual. The drum detector needs a feedwater control valve under the drum
to test the loop, so it can only raise on the two HP drums.

Several detectors confirm with work items rather than a second sensor, the
same way wind's curtailment detector reads its setpoint task: a done
compressor wash (HSIT02), a done thermocouple rejection (HSIT03), an open
instrument calibration on the HRSG (HSIT05, supporting only) and an open
calibration task (HSIT11). Detectors never read attention-item text.

**Robustness.** `robustness.py 10` regenerates the pack with 10 other seeds.
Every item was found on all 10, with no extra detections and the same
confidence each time. Raise times move a little with the noise: HSIT01
11:10–11:40, HSIT02 09:35–10:00, HSIT08 09:20–09:55, HSIT05 13:30–13:40,
the rest within 10 minutes. Seeds only change the noise, so the size of the
fault was also varied for three detectors (5 seeds each, by editing the
constant in a temporary copy of `generate.py`):

- BFP bearing (`BFP_TEMP_RISE_F`, 24 °F in the pack): found every time at
  12 °F, 4 in 5 at 9 °F, 2 in 5 at 8 °F, never at 6 °F. The alert level is
  +6 °F against the sister pump, held 30 minutes, with a rise of at least
  2 °F/h, so smaller faults are too young to raise by "now".
- Hidden steam loss (`LEAK_FRAC_NOW`, 3.4 % of HP steam): found every time
  at 2.5 %, 2 in 5 at 2.0 %, never at 1.7 %. Below about 2 % the heat rate
  rises less than 0.5 % in two hours, inside what hotter air alone does.
- Compressor fouling (`FOUL_DRIFT_PTS`, 0.95 points by 11:25): found every
  time at 0.55 points, 4 in 5 at 0.45, 2 in 5 at 0.40.

**Timing differences with the item narratives.** Worth aligning the text in
`generate.py` the next time it is regenerated:

- HSIT01: the text says the residual crossed its band at 09:30. The
  detector sees the divergence from 10:15 (+3 °F) and raises at 11:25, once
  +6 °F has held for 30 minutes.
- HSIT07: the item starts at 11:45. The detector needs two hours at the same
  AGC target to compare like with like, so it can't look before 12:50, and
  raises at 13:05.
- HSIT08: flagged at 09:30 in the text; the detector raises at 09:45, after
  slip has held above 3 ppm for 20 minutes.
- HSIT11: the text says the DAHS review found it at 13:45. The detector
  raises at 12:35, as soon as the calibration is past its 24-hour interval,
  which would have left 1 h 55 min instead of 25 minutes.
- HSIT04 and HSIT06 raise 15 and 10 minutes after the trigger (sustain
  times); HSIT09 raises at the third excursion (12:50), not the first.

**Data quirks found while building them.**

- HSIT01 says motor current is up about 7 A. In the data, HRSG-2 BFP-A's
  motor current tracks HRSG-1's at the same flow, so the explanation doesn't
  claim it. From 13:20, HRSG-1 BFP-A's flow and bearing temperature
  alternate with the HRSG-1 drum oscillation, which makes the sister-pump
  reference noisier; the "no jump" check uses the bearing's own reading.
- HSIT02's "recovered about 60 %" is measured against the 08:00 efficiency;
  against CTG-1 the wash closed 79 % of the gap by 12:30.
- HSIT03 names TC-14, but the pack holds only the spread, not individual
  thermocouples, so the explanation says which position failed has to come
  from the control system.
- HSIT05 says the steam-flow transmitter is valved out, yet
  `hp_steam_flow_klb_h` on HRSG-1 keeps reading normally. The detector
  treats it as an independent steam-flow measurement.
- HSIT06's STG lag is 5 minutes at the halfway point (08:45 → 08:50), not
  the 10–15 minutes the text gives.

**Limits.** These are reference detectors. Thresholds come from RESEARCH.md
(ISO vibration alert, 20–60 °F normal spread, 1–3 psi dynamics, 5 ppm slip
limit, 26-hour CEMS validity) and were checked against this simulated data.
Comparing against a sister unit fails if both units degrade together, and
the BFP offset is learned from the first hour of the window, so a fault
already present at 08:00 would be hidden. On a real plant they are a
starting point, to be tuned on the site's own history.

## Validator warnings and why they're accepted

- `extra categories (listed after the standard six): ['Electrical',
  'Environmental']`: power plants need both. Generator, exciter,
  transformer and motor signals are electrical. Emissions and weather are
  environmental. That makes 8 categories, the spec maximum.
