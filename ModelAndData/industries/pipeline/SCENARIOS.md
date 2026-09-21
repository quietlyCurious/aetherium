# Natural gas pipeline — scenario sheet (Lodestar Pipeline, 28 Aug 2026)

"Now" is **14:05**. The timeline is 08:00–14:05 at 5-minute steps. Each
scenario's constants live at the top of `generate.py`. The station
throughputs for the day are scripted from these stories; line pack, every
pressure, horsepower and fuel are computed from them (RESEARCH.md §4). The
evidence points and numbers quoted in `attention-items.json` are read back
from the generated series, so this sheet, the data and the narrative
agree.

**The day:**

- **Weather:** a hot late-August day. Ambient climbs from 76 °F to 93 °F:
  more aftercooler fans come on, turbine T5 temperatures creep up, and
  engine detonation margin shrinks.
- **Commercial:** the gas day starts at 09:00. An OFO is in effect
  (±2% imbalance tolerance) because of the heavy power burn.
- **Morning:** Harlow's receipt drop at 08:45 drafts the line, and every
  compressor station backs off in turn.
- **From 10:30:** the Marlow interconnect restriction does the opposite.
  Receipts are unchanged and deliveries are short, so the line **packs**
  from the east end backwards. By 14:05 system line pack is gaining about
  6 MMscf/h, and receipts will only be cut when Marlow's ID2 renomination
  takes effect at 16:00.
- **Everything else** in this file happens on top of that.

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:05 |
|---|---|---|---|
| LSIT01 | 05 Component degradation | Wren · CU-2 · Dry Gas Seals (component) | **open**: investigate |
| LSIT02 | 06 Signal noise (instrument) | Segment 1 · MLV 1-2 (equipment) | resolved, high |
| LSIT03 | 09 Cascade failure | Harlow Receipt (facility, non-leaf) | resolved, high |
| LSIT04 | 07 Ghost signal | Bexley · Regulator Run A (equipment); cause is Bexley · Line Heater | resolved |
| LSIT05 | 11 Hard block | Kettle Creek · CU-3 (equipment, non-leaf) | resolved, high |
| LSIT06 | 10 Overcorrection loop | Ashby Compressor Station (facility, non-leaf) | **open**: act, high |
| LSIT07 | 04 Accumulation | Segment 4 (facility, non-leaf); cause is Marlow's downstream restriction | **recovering** |
| LSIT08 | 13 Quality drift | Sable Ridge · Moisture / H₂S Analyzer (equipment) | resolved |
| LSIT09 | 08 Throughput illusion | Wren Compressor Station (facility, non-leaf); cause is CU-1's recycle valve | **open**: investigate |
| LSIT10 | 12 Recurring micro-events | Kettle Creek · CU-2 · Gas Engine (component) | **open**: investigate |
| LSIT11 | 14 Compliance / plan at risk | Halcyon Point Delivery (facility) | **open**: act, **new** (20 min) |

**Totals:**

- 11 items covering 11 different archetypes, including the required 05,
  06, 07, 09 and 11.
- 9 of 13 units: Harlow, Segment 1, Wren, Sable Ridge, Bexley, Kettle
  Creek, Halcyon Point, Ashby and Segment 4.
- 11 asset types across 3 levels (facility, equipment, component). Five
  items sit on non-leaf assets.
- Outcomes: 5 open, 1 recovering, 5 resolved. There are two `act` items
  and four `high` severity items.
- **Archetype 01 (normal)** is everything else: Segments 2 and 3, Tolland
  City Gate, Marlow's meters and every CP rectifier.
- **Archetype 02 (busy-but-normal)** is the planned work list: turnover,
  aerial patrol, rectifier readings, the MLV annual inspection, an odorant
  sniff test and a meter diagnostics review.

**Unit tiles at 14:05:**

- `attention`: Wren (since 09:10), Kettle Creek (since 11:40), Ashby
  (since 13:15, mode `CONTROLLED_HOLD`), Halcyon Point (since 13:45).
- `running`: everything else. Segment 4's item is recovering, not open,
  so its tile shows running.

## Scenarios

### LSIT01 — Wren CU-2 dry gas seal degradation (05)

- **Asset:** `LODESTAR_WREN_CU2_DGS`. **Primary:** `primary_vent_flow_scfm`.
- **Story:**
  - From 09:10 the NDE primary vent flow rises smoothly and faster over
    time, from 1.37 to 4.70 scfm by 14:05 (alarm 6.0, trip 8.0).
  - CU-1's seals, on the same seal gas, stay at about 1.3 scfm.
- **Secondary signals:**
  - Seal gas filter DP rises with the extra seal gas drawn (4.3 → 6.0
    psid). This is the "related" response on the seal gas path.
  - Shaft vibration, speed and seal gas supply DP stay flat.
- **Ruled out:**
  - Seal-gas header or gas quality (the sister unit is flat).
  - Load change (speed is steady).
- **Times:** start 09:10. Open, so there's no intervention. At the last
  half hour's rate the alarm comes in about 70 minutes.
- **Work:** wk-l14 (check secondary vent, prepare CU-3), not done.
- **Why it's realistic:** RESEARCH §5 #5 [10].

### LSIT02 — MLV 1-2 transmitter fault triggers a potential-rupture alarm (06)

- **Asset:** `LODESTAR_SEG1_MLV2`. **Primary:** `mlv_pressure_psig`.
- **Story:**
  - Between 10:20 and 10:50 the reading drops by 37–108 psi for single
    scans and returns in between (`MLV_SPIKES`).
  - At 10:30 it reads 734 psig against a true 842 psig: 13% in five
    minutes, which meets the 10%-in-15-minutes rupture criterion.
  - Rate of change swings from −21.6 to +28.8 psi/min.
- **What doesn't move (the point of archetype 06):**
  - MLV 1-1 and MLV 1-3 move 2.0 and 1.6 psi over the same window.
  - Harlow receipts and Wren throughput stay steady.
  - No field or public report.
- **Times:** start 10:20; transmitter replaced 11:00; resolved 11:00
  (3h 05m ago).
- **Work:** wk-l08 (site check and transmitter), done 11:00.
- **Why it's realistic:** RESEARCH §5 #3–4 [9].

### LSIT03 — Harlow receipt cut cascades down the line (09)

- **Asset:** `LODESTAR_HARLOW`. **Primary:** `receipt_flow_mmscfd`.
- **Story:**
  - The Harlow plant's residue compressor trips at 08:42.
  - Receipts fall from 905 to 638 MMscf/d at 08:45, restart at 09:30 and
    are back at 904 by 09:50.
- **Cascade, in flow order (`gas_flow` layer):**
  - Wren cuts throughput to 701 MMscf/d within 15–20 minutes, and its
    units go into recycle (12%) to hold minimum flow.
  - Segment 2 inlet pressure falls from 958 to 913 psig.
  - Kettle Creek bottoms at 806 at 09:55.
  - Ashby bottoms at 770 at 10:10.
  - System line pack draws down 9.8 MMscf; the line pack change rate
    reads about −10 MMscf/h.
- **Ruled out:** a measurement fault, because Wren's flow agrees with
  the receipt meters.
- **Times:** start 08:45; restart 09:30; resolved 09:50 (4h 15m ago).
- **Work:** wk-l07 (confirm restart with the plant), done.
- **Why it's realistic:** RESEARCH §5 #1 [1][12].

### LSIT04 — Bexley regulator icing, caused by the line heater upstream (07)

- **Asset:** `LODESTAR_BEXLEY_REGA`. **Primary:** `reg_outlet_temp_f`.
  **Root cause:** `LODESTAR_BEXLEY_HTR`.
- **Story:**
  - The heater's flame fails at 10:15 (firing 0%).
  - The bath cools from 178 °F to 129 °F by 12:05, and heater outlet gas
    from 91 °F to 71 °F.
  - The regulator runs sit about 39 °F below the heater outlet, the
    Joule-Thomson drop for a ~560 psi cut (7 °F per 100 psi).
  - Run A outlet gas falls from 52 °F to a low of 31.8 °F around 12:00. From 11:20 the
    regulator hunts: outlet pressure swings about ±6 psi and valve travel
    oscillates.
- **Lag:** the heater leads the symptom by about 65 minutes. Run B cools
  in step.
- **Ruled out:**
  - The regulator itself.
  - Sable Ridge moisture (elevated 09:30–11:30, but the temperature
    follows the heater).
- **Times:** start 10:15; relit 12:10; recovered 12:45 (resolved 1h 20m
  ago).
- **Work:** wk-l10 (relight), done 12:10.
- **Why it's realistic:** RESEARCH §5 #11 [8][17].

### LSIT05 — Kettle Creek CU-3 trips on a broken compressor valve (11)

- **Asset:** `LODESTAR_KETTLE_CU3`. **Primary:** `recip_unit_flow_mmscfd`.
  **Root cause:** `LODESTAR_KETTLE_CU3_FRAME`.
- **Story:**
  - Valve-cover temperature deviation rises from 6 °F at 11:25 to 29.6 °F
    at 11:50, and frame vibration from 0.22 to 0.93 in/s.
  - The unit trips at 11:52 (vibration high-high). CU-3 flow goes from
    239 MMscf/d to 0; 11:55 is the first zero sample.
- **Related effects:**
  - Station throughput falls from 947 to 827 MMscf/d.
  - Suction side (Segment 2) packs: 750 → 772 psig.
  - Discharge side (Segment 3) drafts: discharge 954 → 932 psig and line
    pack 198.2 → 196.3 MMscf.
  - The remaining units run at about 85% load, and CU-2 has its first
    detonation event (LSIT10).
- **Times:** trip 11:52; standby CU-5 started 12:15 and fully loaded
  12:35; resolved 12:35 (1h 30m ago). The broken suction valve plate was
  found at 13:30.
- **Work:** wk-l11 (pull the CU-3 valves), not done, due 17:00.
- **Why it's realistic:** RESEARCH §5 #8 [11].

### LSIT06 — Ashby discharge oscillation (10)

- **Asset:** `LODESTAR_ASHBY`. **Primary:** `station_discharge_pressure_psig`.
- **Story:**
  - At 12:50 gas control lowers Ashby's discharge limit from 985 to
    965 psig (see LSIT07). Throughput falls to about 630 MMscf/d, putting
    both units below minimum flow, so their recycle valves open (up to
    29%).
  - From 13:15 discharge pressure oscillates on a ~20-minute cycle with
    growing amplitude: about ±6 psi at 13:20, and 937–970 psig in the last
    cycle.
  - Manual setpoint moves at 13:20 and 13:40 landed out of phase.
- **Secondary signals:** station throughput swings about ±24 MMscf/d.
  MLV 4-1, 20 miles downstream, sees a damped ±5 psi.
- **Times:** start 13:15; still open (act, high).
- **Work:** wk-l12 (stabilise control), not done, due 14:20.
- **Why it's realistic:** RESEARCH §5 #7 [15].

### LSIT07 — Segment 4 packs behind the Marlow restriction (04)

- **Asset:** `LODESTAR_SEG4`. **Primary:** `line_pack_mmscf`. **Root
  cause:** outside the model (the downstream pipeline's compressor
  outage), seen at `LODESTAR_MARLOW`.
- **Story:**
  - At 10:30–10:45 Marlow's flow drops from ~735 to ~612 MMscf/d against
    a 735 schedule.
  - Segment 4 line pack rises from 178.9 to 188.9 MMscf (peak 12:55).
    Marlow delivery pressure rises from 824 to 893 psig, and Ashby
    discharge reaches 976 psig (limit 985, MAOP 1,000).
  - Ashby is held back at 12:50, and Segment 4 unpacks at about
    2.7 MMscf/h, to 185.8 now.
- **Related effects:** the gas moves upstream rather than disappearing.
  Segment 3 gained 6.7 MMscf and the system 6.0 MMscf in the last hour.
- **Times:** start 10:30; intervention 12:50; recovering (since text
  measured from the intervention, 1h 15m).
- **Work:** coordination sits with Marlow's ID2 renomination (effective
  16:00), noted in whatChanged. There's no separate work item.
- **Why it's realistic:** RESEARCH §5 #12 [12][13].

### LSIT08 — Sable Ridge wet gas (13)

- **Asset:** `LODESTAR_SABLE_QA`. **Primary:** `water_content_lb_mmscf`.
- **Story:**
  - From 09:00 water content rises from 3.2 to 6.6 lb/MMscf by 11:05
    (tariff limit 7.0).
  - The filter/separator catches glycol carry-over: its level climbs to
    62% from about 09:30 and dumps at 11:25. This is the related response
    on the `gas_flow` path.
  - Receipts stay on nomination at about 181 MMscf/d, and H₂S and HC dew
    point don't move.
- **Times:** start 09:00; producer restores glycol circulation 11:05;
  back under 3.5 by 12:00 (resolved 2h 05m ago).
- **Work:** wk-l09 (call the producer), done 10:20.
- **Why it's realistic:** RESEARCH §5 #2 [6].

### LSIT09 — Wren burning more fuel for the same throughput (08)

- **Asset:** `LODESTAR_WREN`. **Primary:** `station_fuel_mmscfd`. **Root
  cause:** `LODESTAR_WREN_CU1` (anti-surge recycle valve passing).
- **Story:**
  - From 11:30 CU-1's compressor flow grows above CU-2's by up to about
    58 MMscf/d (`RECYCLE_LEAK_NOW`), while its recycle command reads 0%.
  - Station throughput, the headline number, stays at about 905 MMscf/d.
  - Station fuel rises 3.54 → 3.91 MMscf/d (+10%).
- **Splitting the rise:**
  - About half is the higher compression ratio as the line packs (1.219
    → 1.233).
  - The rest is CU-1's extra flow (CU-1 11,300 hp vs CU-2 10,100 hp at
    the end).
- **Times:** start 11:30; still open (investigate).
- **Work:** none yet. The recommendation is a recycle-line temperature
  check and a stroke test.
- **Why it's realistic:** RESEARCH §5 #6 [15][4].

### LSIT10 — Kettle Creek CU-2 detonation events (12)

- **Asset:** `LODESTAR_KETTLE_CU2_ENG`. **Primary:** `knock_events_1h`
  (rolling one-hour count).
- **Story:**
  - Eight events at `KNOCK_TIMES` (11:40 … 14:05), coming closer
    together. Five fell in the last hour; normal is 0–1.
  - Each event dips CU-2's power and flow by about 9% for one sample, and
    the other units pick up the difference.
  - CU-4 had a single event at 12:40, which is normal.
- **Drivers:** ambient 88 → 93 °F, and higher unit load after the CU-3
  trip (LSIT05).
- **Ruled out:** fuel quality (Harlow HHV and Sable Ridge composition
  steady).
- **Times:** start 11:40; still open (investigate).
- **Why it's realistic:** RESEARCH §5 #9 *(practice)*.

### LSIT11 — Halcyon Point imbalance will pass the OFO tolerance (14)

- **Asset:** `LODESTAR_HALCYON`. **Primary:** `gas_day_imbalance_mmscf`.
- **Story:**
  - The imbalance resets to 0 at the 09:00 gas-day start (the prior gas
    day closed at +0.62).
  - It is slightly negative during the plant's fuel-heater runback, then
    grows about 0.42 MMscf/h once the ccgt plant ramps for the afternoon
    peak: take about 105 vs 95 scheduled.
  - It is +1.45 MMscf at 14:05 against a ±1.9 tolerance, which is crossed
    at about 15:10.
- **Why it's at risk:** ID2 (12:30) passed without a renomination, and
  ID3 (17:00 deadline) only takes effect at 20:00. The time needed is
  greater than the time left.
- **Times:** found 13:45 by the gas scheduler (the "new" item, 20 min);
  open (act).
- **Work:** wk-l13 (call the shipper), not done, due 14:30.
- **Why it's realistic:** RESEARCH §5 #13 [13][19].

## Detectors and explanations (spec §14)

`explain.py` runs eleven detectors, one per failure mode, on every asset
each applies to, and writes `public/data/pipeline/explanations.json`. Each
one reads only the runtime files, never this sheet or `generate.py`'s
constants. Two inputs aren't telemetry, so `explain.py` declares them as
external feeds, the way wind declares its dispatch instruction: today's
OFO notice (±2 % tolerance) and the nomination-cycle calendar (ID1 10:00 →
14:00, ID2 12:30 → 16:00, ID3 17:00 → 20:00). Both are used only by the
LSIT11 detector.

| Item | Detector | Ran on | Fired on | Raised at | Confidence |
|---|---|---|---|---|---|
| LSIT01 | `pipeline.dry_gas_seal_leak` | 5 dry gas seals | Wren CU-2 | 11:20 | medium |
| LSIT02 | `pipeline.mlv_transmitter_fault` | 12 mainline valves | MLV 1-2 | 10:30 | high |
| LSIT03 | `pipeline.receipt_loss_cascade` | 2 receipt stations | Harlow Receipt | 09:00 | high |
| LSIT04 | `pipeline.regulator_icing_upstream_heater` | 4 regulator runs | Bexley Run A, Run B (grouped into one Bexley item; cause on the line heater) | 11:35 | high |
| LSIT05 | `pipeline.recip_valve_trip` | 5 recip compressor units | Kettle Creek CU-3 (cause on its compressor frame) | 11:55 | high |
| LSIT06 | `pipeline.station_control_oscillation` | 3 compressor stations | Ashby | 13:55 | medium |
| LSIT07 | `pipeline.segment_packing` | 4 line segments | Segment 4 (cause at Marlow) | 11:35 | high |
| LSIT08 | `pipeline.receipt_wet_gas` | 2 gas quality analyzers | Sable Ridge analyzer | 09:50 | high |
| LSIT09 | `pipeline.hidden_recycle_fuel` | 2 turbine compressor stations | Wren (cause on CU-1) | 13:10 | medium |
| LSIT10 | `pipeline.engine_detonation` | 5 gas engines | Kettle Creek CU-2 engine | 13:15 | medium |
| LSIT11 | `pipeline.ofo_imbalance_at_risk` | 1 power-plant delivery | Halcyon Point | 13:40 | n/a |

No detector fired anywhere else. Every computed confidence matches the
item's `confidenceLevel`. Where a detector says "high", it is because the
loop closed in the data (reading clean after the transmitter work, recovery
after the heater relight, receipts and stations back, line pack turning,
water clearing) or, for LSIT05, because the maintenance log on the item
records the valve found broken at 13:30.

**Robustness.** `robustness.py 10` regenerates the pack with 10 other seeds.
Every item was found on all 10, with no extra detections. Seeds only change
the noise, so the size of the fault was also varied for two detectors
(5 seeds each, by editing the constant in a temporary copy of
`generate.py`):

- Dry gas seal (`DGS_RISE_SCFM`, extra vent flow by 14:05; today 3.3 scfm):
  found every time down to 1.0 scfm, 4 in 5 at 0.7–0.8 scfm, 2 in 5 at
  0.6 scfm. The alert level is +0.5 scfm above expected, held for 30
  minutes, so a leak much under +0.7 scfm is too young to raise by "now".
  The smaller the leak, the later the raise: 11:05–11:20 at 3.3 scfm,
  12:30–13:25 at 1.0 scfm.
- Hidden recycle (`RECYCLE_LEAK_NOW`, gas going round CU-1 by 14:05; today
  58 MMscf/d): found every time down to 30 MMscf/d (about 3 % of
  throughput), 3 in 5 at 25, never at 20. The unit-flow excess has to pass
  2 % of station throughput for 30 minutes and fuel has to rise 3 % in two
  hours; under about 25 MMscf/d that doesn't happen by "now". Unit flow
  meters on a real station are rarely better than 1–2 %, so smaller leaks
  need a longer baseline or a recycle-line temperature.

**Timing differences with the item narratives.** Some items are raised at a
different time than the hand-written text implies. Worth aligning the text
(in `generate.py`) the next time it is regenerated:

- LSIT01: the text says the vent flow left its band at 09:10. Against its
  sister seals, the residual passes +0.15 scfm at 10:10 and the +0.5 scfm
  alert at 10:50; the detector raises at 11:20, after 30 minutes above it.
- LSIT04: the heater lost its flame at 10:15, but the item is about the
  regulator, which went under 40 °F at 11:20. The detector raises at 11:35.
- LSIT06: the text puts the start at 13:15. Calling it a growing
  oscillation needs two full cycles (four alternating swings over 4 psi,
  the last 30 % bigger than the first), so it raises at 13:55.
- LSIT07: Marlow was restricted at 10:30–10:35; the line pack slope passes
  1.5 MMscf/h at 11:05 and has to hold for 30 minutes, so it raises at 11:35.
- LSIT08: the text's moisture alarm is at 10:00. The detector raises at
  09:50, when the one-hour trend first projects the 7 lb/MMscf limit within
  two hours.
- LSIT09: the text says CU-1 diverged at 11:30. The unit-flow excess is
  under 0.5 % of throughput until 11:55 and passes 2 % at about 12:40; the
  detector raises at 13:10.
- LSIT10: the first event was at 11:40; the detector waits for 3 events in
  one hour (13:15), since 0–1 an hour is normal.
- LSIT11: the scheduler flagged it at 13:45; the detector raises at 13:40,
  when the projected crossing comes within its 90-minute lead time.

**Data quirks noticed while building these.**

- LSIT05: the item's whatChanged records "Valve cap pulled: suction valve
  plate broken" at 13:30, but work item wk-l11 ("Pull CU-3 cylinder valves
  for inspection") is still not done, due 17:00.
- LSIT09: whatChanged lists 11:30 before 10:40 (out of time order).
- LSIT10: the text links the events to ambient 88 → 93 °F and higher load
  after the CU-3 trip. The pack has no ambient temperature property, and
  CU-2's load between events (82 % of rating) is lower than in the first
  hour (86 %), so the explanation says load alone doesn't explain the
  timing and leaves charge-air temperature "not yet checked".
- Segment 3 packs at about 5–6 MMscf/h from 12:55 (the gas held back from
  Segment 4). No detector flags it on its own: the packing detector needs a
  delivery below schedule directly downstream, and Segment 3's deliveries
  are Ashby (a station) and Halcyon Point (over, not under, schedule). The
  LSIT07 explanation reports it as where the gas went.

**Limits.** These are reference detectors. Their thresholds come from
RESEARCH.md (rupture rule 10 % in 15 minutes, 7 °F per 100 psi of pressure
cut, the 7 lb/MMscf tariff limit, the illustrative 6.0 scfm seal alarm) and
were checked against this simulated data. On real SCADA they are a starting
point, to be tuned on the line's own history. Two confirmations come from
text rather than telemetry: LSIT01's flowmeter check and LSIT05's
inspection are read from the maintenance entries in the item's
whatChanged, matched on the part the detector is about ("flowmeter",
"valve").

## Validator warnings and why they're accepted

- **`[hierarchy]` operating_district instances have different child
  types.** Districts are geographic containers. The West has a receipt, a
  segment and a turbine station; the Central adds a field receipt, a city
  gate and a recip station; the East has deliveries of three kinds. This
  is the "container holding a mix" case in spec §3.1, so it stays one
  type.
- **`[properties]` extra category `Electrical`.** It covers CP rectifier
  output voltage and current, which are neither equipment condition nor
  process flow. That makes 7 categories in total (≤ 8).

## Known app behaviour this pack makes visible (no data change needed)

- **Related-asset boxes show a type's example instance, not the selected
  asset's own neighbour.** `getRelatedAssetsForType` builds type-to-type
  rows, and each row's box shows `relatedTypeExampleAssetId`, the first
  instance found anywhere in the model. In a series chain, instances of
  one type have different neighbours. For example, under Segment 4 the
  "Compressor Station (Engine / Reciprocating)" boxes show Kettle Creek's
  numbers, and a "City Gate Station" box shows Bexley's, even though
  Segment 4's neighbours are Ashby and Tolland. The same mechanism
  applies to the existing packs wherever same-type instances have
  different neighbours. It's just more noticeable in a series chain. A fix would be a `src/` change (resolve each row to the
  selected asset's actual related instance, if one exists), so it was left
  alone.
- **All Assets diagram initial zoom:** in headless Chromium the diagram
  lays out all 111 nodes but opens at scale 2, off the nodes, until you
  zoom out. `ccgt` behaves identically, so this isn't specific to this
  pack.
