# Vesper Grid — scenario sheet

Twelve attention items on 2026-08-28, 08:00–14:05 (74 points, 5-minute
steps). "Now" is 14:05. Every number quoted here is read from the
generated series; the constants that produce them live in one block in
`generate.py` §6, which is also what the narratives quote, so the story
and the data cannot drift apart. Failure-mode references (§5.x) are to
`RESEARCH.md`.

## The shift in one paragraph

A hot late-August morning on the rising side of the load ramp, with the
system peak still three hours away. At 09:40 a capacitor can fails at
Wyndham and takes the bank out, sagging a 69 kV bus two stations away
and quietly eating the network's reactive reserve. At 10:15 the
Orrin–Larkspur 138 kV circuit faults, fails to reclose and locks out;
the flow it was carrying arrives the long way round, and by 10:35 the
worst post-contingency loading in Harrow District is above 100 % of
emergency rating. At 11:20 the operator closes a normally-open 69 kV tie
to relieve it, which works — and moves part of the exposure onto
Bexhill instead. Underneath all of that, four pieces of equipment are
telling slower stories, and one planned job has to be deferred because
the network is no longer intact.

## The twelve items

| Item | Archetype | Asset (level) | Primary property | Outcome at 14:05 |
|---|---|---|---|---|
| GSIT01 | 05 Component degradation | Aldergate T1 Bushing Set (component) | `bushing_c1_pf_pct` | open, `act`, high |
| GSIT02 | 03 Quiet drift | Kessler T2 DGA Monitor (component) | `dga_tdcg_rate_ppm_day` | open, `investigate` |
| GSIT03 | 06 Signal noise / instrument fault | Larkspur 138 kV Bus CVT (device) | `v_redundant_dev_pct` | resolved |
| GSIT04 | 10 Overcorrection loop | Wyndham T1 Tap Changer (component) | `oltc_ops_per_day` | recovering, `act` |
| GSIT05 | 11 Hard block | Orrin · Larkspur 138 kV Line (bay) | `mw_flow_mw` | open, `act`, high |
| GSIT06 | 09 Cascade / redistribution | Larkspur (substation, non-leaf) | `worst_post_ctg_loading_pct` | recovering, `act`, high |
| GSIT07 | 07 Ghost signal | Dunmore 69 kV Bus (bay) | `bus_voltage_pu` | resolved |
| GSIT08 | 12 Recurring micro-events | Wexford · Tilbury 69 kV Breaker (device) | `reclose_ops_count` | resolved |
| GSIT09 | 04 Accumulation / saturation | Kessler T1 Autotransformer (device) | `winding_hotspot_temp_c` | resolved, high |
| GSIT10 | 08 Throughput illusion | Thorne (substation) | `mvar_reserve_mvar` | open, `investigate` |
| GSIT11 | 13 Quality drift | Colvin 69 kV Bus (bay) | `bus_voltage_thd_pct` | open, `investigate` |
| GSIT12 | 14 Plan or compliance at risk | Harrow District (district, above the unit level) | `worst_post_ctg_loading_pct` | open, `investigate` |

**Coverage.** Twelve items covering twelve archetypes, including the
required 05, 06, 07 and 11. Archetypes 01 and 02 are the background, as
in every other pack: 01 (normal shift) is the rest of the network —
Aldergate and Thorne's 345 kV bays, Pell, Navarre and Tilbury, every
station battery and every protection channel; 02 (busy but normal) is
the planned half of the work list.

They touch **9 of the 13 units** (Aldergate, Wyndham, Kessler, Thorne,
Orrin, Larkspur, Wexford, Colvin, Dunmore), **11 asset types** and
**five hierarchy levels** — component, device, bay, substation and
district. GSIT06 is on a non-leaf asset; GSIT12 is above the unit level,
so its `unitId` is null.

Outcomes: 4 resolved, 2 recovering, 6 open. That is fewer resolved than
the spec's "about half", and deliberately so — a 138 kV circuit locked
out with a patrol still walking it is the spine of the shift, and three
of the open items (GSIT05, GSIT06 via its `recovering` state, GSIT12)
are consequences of it that cannot close until the circuit is back.
GSIT12 started at 13:40, 25 minutes before "now", which lights the new
dot on the Attention icon.

---

## GSIT01 · Aldergate T1 345 kV bushing — archetype 05

**Failure mode:** RESEARCH §5.1. **Asset:**
`VESPER_ALDERGATE_T1_XFMR_BUSH` (component). **Root cause:** on the
asset itself — grading layers shorting in the condenser core.

| Time | What happens |
|---|---|
| 09:30 | C1 power factor 0.376 %, capacitance deviation 0.50 %, leakage 43.4 mA — baseline, first-stage alert |
| 12:30 | Power factor has doubled to 0.759 % — second-stage alert |
| 13:30 | Doble test added to the Saturday outage request |
| 14:05 | 0.956 %, capacitance deviation 4.19 %, leakage 59.7 mA — still rising |

Three independent bushing measurements move together, which is what
separates a real defect from an instrument problem (compare GSIT03,
where exactly one measurement moves). Nothing else on T1 moves: top oil
is 64.6 °C and the bank is at 68 % of nameplate. The transformer's own
DGA hydrogen creeps up 7 ppm, which is present but not diagnostic — the
defect is in the bushing core, not the main tank.

**Ruled out:** main-tank fault (DGA pattern absent), overload (loading
normal), measurement error (three measurements agree, sister phases
flat).

**Work:** `wk-g08`, Doble test, urgent, not done.

---

## GSIT02 · Kessler T2 dissolved gas — archetype 03

**Failure mode:** RESEARCH §5.2. **Asset:**
`VESPER_KESSLER_T2_XFMR_DGA` (component). **Root cause:** a developing
local hot spot inside T2.

| Time | TDCG rate | Ethylene | Hydrogen |
|---|---|---|---|
| 08:10 | 1.77 ppm/day | 13.9 ppm | 31.7 ppm |
| 10:50 | 4.79 | — | — |
| 14:05 | 9.02 ppm/day | 41.6 ppm | 90.0 ppm |

Acetylene stays at 0.27 ppm throughout. That is the whole diagnosis:
rising ethylene and hydrogen **without** acetylene is thermal, not
arcing. The rate is still well under the 30 ppm/day action level, so
this is a six-hour window onto a weeks-long story — the item exists to
show a trend that has not resolved and should not resolve today.

Note that T2 also carries the reduced half of the Kessler load-sharing
imbalance in GSIT09. The two are independent: the gas trend starts at
08:10, two hours before the load ramp, and does not change slope when
the taps are rebalanced.

**Work:** `wk-g09`, lab resample, important, not done.

---

## GSIT03 · Larkspur bus CVT — archetype 06 (instrument versus process)

**Failure mode:** RESEARCH §5.3. **Asset:**
`VESPER_LARKSPUR_BUS138_CVT` (device).

| Time | What happens |
|---|---|
| 09:00 | Redundant-measurement deviation 0.24 %, secondary 68.01 V |
| 11:35 | Deviation crosses the 5 % alarm threshold at 5.03 % |
| 12:10 | Automatic voltage control blocked on this input — resolved |
| 14:05 | Deviation 6.12 %, secondary 63.80 V, flat since the block |

**What does not move is the point.** The redundant relay on the same
bus, the Wyndham–Larkspur line CVT, the 138 kV MW and MVAr flows, the
line currents and the 69 kV bus voltage are all unchanged across the
whole window. Every other scenario in this pack has a corroborating
signal somewhere; this one has none, by construction, and the
Investigate panel's related-assets view should show that plainly.

The scenario also has a second edge to it: if the drift had been
believed, the tap changer would have chased it — which is how a sensor
fault becomes a protection or control misoperation.

**Work:** `wk-g10`, block the CVT as a control source, done at 12:10.

---

## GSIT04 · Wyndham T1 tap changer hunting — archetype 10

**Failure mode:** RESEARCH §5.4. **Asset:**
`VESPER_WYNDHAM_T1_XFMR_OLTC` (component).

| Time | Ops/day | Tap |
|---|---|---|
| 09:45 | 4.6 | steady |
| 10:10 | 43.4 | cycling ±2 |
| 12:40 | 57.0 | cycling ±2 |
| 12:55 | 50.1 | bandwidth widened 1.5 V → 2.0 V, delay 20 s → 30 s |
| 14:05 | 13.0 | steady |

`oltc_ops_total` accumulates from the per-day rate at every step, so the
counter's slope visibly changes twice — once when the hunting starts and
once when it is fixed. The paralleled Aldergate T1 tap changer picks up
6.2 ops/day over the same window, which is the parallel bank fighting
it and the corroborating signal for the diagnosis.

Regulated voltage never leaves its band. This is the scenario where
**nothing on the operator's normal display looks wrong** and the damage
is entirely in the wear counter.

**Work:** `wk-g11`, bandwidth change, done at 12:45.

---

## GSIT05 · Orrin–Larkspur 138 kV lockout — archetype 11

**Failure mode:** RESEARCH §5.5. **Asset:**
`VESPER_ORRIN_BAY_LARKSPUR138` (bay). Both ends of the circuit carry
the event; the item is filed at the Orrin end.

| Time | What happens |
|---|---|
| 10:10 | 56.2 MW, normal |
| 10:15 | A-phase-to-ground fault; both ends trip; flow to zero in one scan |
| 10:20 | Reclose attempt fails; 86 lockout operates |
| 11:05 | Patrol dispatched to structures 41–78 |
| 14:05 | Still out |

The breaker at each end steps `breaker_ops_total` by 2,
`reclose_ops_count` by 1, `accum_interrupt_i2t_ka2s` by 3.84 kA²s and
`contact_wear_pct` by 1.6 — the event writes itself into the condition
data, not just the flow.

**The sag is simultaneous, not travelling.** Every 138 kV bus registers
a dip in the same 10:15 scan, with depth set by electrical distance:
0.063 pu at Orrin, 0.058 pu at Larkspur, 0.031 pu at Bexhill, 0.018 pu
at Aldergate, 0.015 pu at Wyndham, 0.006 pu at the Kessler 345 kV bus.
Showing a sag spreading outward over seconds would be wrong and a
utility audience notices (RESEARCH §6).

**Consequence:** the element is out of the contingency set, which is
what GSIT06 and GSIT12 are about.

**Work:** `wk-g12`, line patrol, urgent, not done.

---

## GSIT06 · Larkspur exposed on the next contingency — archetype 09

**Failure mode:** RESEARCH §5.6 and §5.12. **Asset:**
`VESPER_LARKSPUR` (substation — a non-leaf asset at the unit level).
**Root cause:** GSIT05, one station away.

| Time | Larkspur worst post-contingency | What happened |
|---|---|---|
| 10:10 | 51.3 % | before the lockout |
| 10:20 | 78.7 % | flow redistributed |
| 10:35 | crosses 100 % | |
| 11:05 | 103.6 % | |
| 11:20 | 105.1 % | peak — normally-open tie closed |
| 11:40 | 87.9 % | |
| 14:05 | 98.6 % | climbing again with the load ramp |

Measured redistribution, within three scans of the lockout:
Wyndham–Larkspur 105.5 → 140.7 MW, Larkspur–Wexford 30.5 → 48.1 MW,
Larkspur T1 36.0 → 61.9 MVA. Closing the tie at 11:20 puts 11.2 MW onto
the Navarre–Dunmore tie and takes T1 back to 51.7 MVA.

**The honest part.** Closing the tie does not make the problem go away,
it moves it: Bexhill T1 picks up 8.1 MVA and Bexhill's own worst
post-contingency loading is 97.3 % at 14:05, second only to Larkspur.
The `CTG_EXPOSED` table in `generate.py` §8 is where that shows up — the
contingency severity of each element is a function of **time**, because
the study set changes when the topology does. Elements around Larkspur
get worse at 10:15 and better at 11:20; Bexhill's get worse at 11:20.

**Worth pointing at in a demo:** the same exposure appears in two
different districts. The Wyndham end of the Wyndham–Larkspur circuit
rolls up into Keldon District at 98.7 %, and the Larkspur end into
Harrow at 98.6 % — one circuit, one problem, two branches of the
containment tree. That is the difference between the tree and the
network made visible.

**Work:** `wk-g13`, tie switching order, done at 11:20.

---

## GSIT07 · Dunmore 69 kV voltage sag — archetype 07 (cause upstream)

**Failure mode:** RESEARCH §5.7, with §5.8 as the cause. **Asset:**
`VESPER_DUNMORE_BUS69` (bay). **Root cause:**
`VESPER_WYNDHAM_CAPBANK_CAP`, two stations and two voltage levels away.

| Time | Dunmore bus | What happened |
|---|---|---|
| 09:35 | 1.007 pu | normal |
| 09:40 | 0.945 pu | Wyndham capacitor bank trips on neutral unbalance |
| 10:25 | 0.943 pu | lowest point, below the 0.95 pu pre-contingency floor |
| 10:40 | 0.955 pu | Larkspur and Colvin taps raised two steps — resolved |
| 14:05 | 0.984 pu | holding |

The cause is a **step**, not a ramp: the bank's `cap_neutral_unbal_a`
goes 0.144 A → 1.314 A at 09:40 and stays there, which is a failed can
and its fuse rather than a drifting measurement.
`cap_bank_mvar` and the bay's `bay_reactive_mvar` go to zero in the same
scan.

Sag depth by station, all in the same scan: Dunmore 0.064 pu, Larkspur
69 kV 0.044 pu, Navarre 0.025 pu, Tilbury 0.022 pu, Larkspur 138 kV
0.021 pu, and Wyndham's own 138 kV bus — the station where the
equipment actually failed — only 0.018 pu. **The alarm is furthest from
the cause.** That is the scenario.

It also feeds GSIT10: the 50 MVAr this bank was supplying is where half
of Thorne's missing reactive reserve went.

---

## GSIT08 · Recurring momentaries on Wexford–Tilbury 69 kV — archetype 12

**Failure mode:** RESEARCH §5.9. **Asset:**
`VESPER_WEXFORD_BAY_TILBURY69_CB` (device).

Successful auto-recloses at 08:25, 09:15, 10:05, 11:10 and 12:00.
`reclose_ops_count` 5 → 10, `accum_interrupt_i2t_ka2s` +2.10 kA²s,
`contact_wear_pct` +1.8 points. Tilbury's 69 kV bus dips 0.043 pu and
Wexford's 0.028 pu at each event and recovers in the next scan.

No customer was interrupted and no individual event is worth an alarm —
each is under a minute, so none reaches the outage log. The item exists
because the *pattern* is worth an alarm and nothing in a conventional
alarm list would ever raise one. Patrol cleared a limb at structure 22
at 12:20; nothing since.

---

## GSIT09 · Kessler T1 winding hot spot — archetype 04

**Failure mode:** RESEARCH §5.11. **Asset:**
`VESPER_KESSLER_T1_XFMR` (device). **Root cause:** load plus ambient,
made worse by unequal sharing between the two paralleled banks.

| Time | Hot spot | Loading | Note |
|---|---|---|---|
| 10:20 | 73.7 °C | 59.9 % | the redistribution reaches Kessler |
| 11:20 | 84.7 °C | — | |
| 12:35 | 105.3 °C | — | alert |
| 12:50 | 107.9 °C | 93.9 % peak | taps rebalanced, ambient 32.1 °C |
| 13:10 | 102.0 °C | — | |
| 14:05 | 99.4 °C | 80.8 % | T2 also at 80.9 % |

**Nothing about the temperature is drawn.** The generator injects only
*load*: +22 MVA of extra throughput at Kessler after the lockout, split
between the two banks with a 27 MVA imbalance from a tap mismatch, then
the imbalance removed at 12:50. `thermal_pass()` then derives top oil,
hot spot, cooling stages and radiator drop from the final load and the
ambient curve. At 12:45 T1 is carrying 140.8 MVA against T2's 87.1 MVA
on identical 150 MVA banks; after the rebalance both sit at 116.6 MVA.
The 105 °C alert, the peak and the recovery all fall out of the physics,
which is why the hot spot lags the load peak by two scans.

This is the accumulation archetype rather than a step: heat in exceeds
heat out for two and a half hours, and every cooling stage was already
running from the start of the ramp.

---

## GSIT10 · Thorne reactive reserve — archetype 08 (throughput illusion)

**Asset:** `VESPER_THORNE` (substation). **Root cause:** GSIT07's
capacitor bank, plus the afternoon ramp.

| Time | Reserve | What happened |
|---|---|---|
| 09:35 | 168.5 MVAr | normal |
| 09:45 | 113.0 MVAr | step of 52 MVAr — the Wyndham bank is gone |
| 11:10–11:40 | 110.6 → 35.0 MVAr | the shunt reactor is committed to holding 345 kV volts |
| 14:05 | 38.2 MVAr | against a 120 MVAr operating target |

Meanwhile Thorne's 345 kV circuits sit at 57 % and 34 % of normal
rating, and `worst_post_ctg_loading_pct` at Thorne never troubles
anything. **The headline number is fine and the thing behind it is
not** — which is exactly archetype 08, translated from throughput into
reactive support. Wyndham's own reserve falls from 161.2 to 109.9 MVAr
over the same window, so the evidence for the diagnosis is at a
different station from the item.

The 120 MVAr target is presented as this utility's own operating
target, not a standard: no published real-time reactive reserve
threshold could be verified (RESEARCH §6).

---

## GSIT11 · Colvin 69 kV harmonic drift — archetype 13

**Asset:** `VESPER_COLVIN_BUS69` (bay). THD 0.97 % at 09:05 → 2.05 % at
14:05, against the IEEE 519 limit of 2.5 % for this voltage class.
Negative sequence voltage rises 0.43 points; Tilbury, one circuit away,
rises 0.56 points — weaker, which is what places the source downstream
of Colvin rather than on the 138 kV system.

Voltage, flows and every equipment temperature at Colvin stay normal.
The item is open at "now" and still rising, with the evening peak ahead:
a limit that has not been crossed yet is the whole tension of the
quality-drift archetype, so resolving it would have spoiled it.

---

## GSIT12 · Bexhill T1 clearance deferred — archetype 14

**Asset:** `VESPER_HARROW` (district — **above** the unit level, so
`unitId` is null and `line` is the district's own name). Started 13:40,
25 minutes before "now".

District worst post-contingency loading is 98.6 % with Bexhill T1 in
service. The study with T1 out returns 118 % on the Bexhill–Orrin
circuit — a figure quoted in the item text as a study result, not a
generated series, because a contingency that has not been taken has no
telemetry. Time needed for the six-year protection test is 4h 00m;
3h 55m of switching window remain. Both the margin and the clock fail,
and the compliance date is 31 August — three days out, so deferring is
the right answer rather than the easy one.

This is the item that ties the routine work list to the reliability
story: `wk-g07` (the clearance package) is planned work that the
network's state has just invalidated.

---

## Planned background — archetypes 01 and 02

Seven of the thirteen work items are routine, and every interval is
sourced (RESEARCH §6): shift turnover and outage-log review, same-day
load forecast review, Kessler's monthly substation inspection, Pell's
four-month station battery check, Wyndham T1's annual oil sample, the
Larkspur–Dunmore right-of-way vegetation inspection, and the Bexhill T1
clearance package. Six are created from situations, each on the same
asset as its attention item, with `sourceLabel: "From: <that item's
signal>"`.

Five work items are left open at "now" — `wk-g06`, `wk-g07`, `wk-g08`,
`wk-g09` and `wk-g12` — and all five are due after 14:05.

Pell is in `MAINTENANCE` mode for the battery work, Dunmore in
`CHANGEOVER` since the tie closed at 11:20, Orrin in `CONTROLLED_HOLD`
under the restricted configuration, and Bexhill, Kessler and Larkspur in
`RAMP_UP`. All five modes are in the spec's colored set, so nothing
falls back to a neutral tile.

---

## Validator warnings and why they stand

`python3 ModelAndData/tools/validate_industry_pack.py grid` reports
**0 errors and 1 warning**:

> `type bulk_substation instances have different child types`

This is the container case the spec explicitly allows (§3.1: "It's a
container that just holds a mix … keep one type. The validator warns
about it, and that's expected"). A bulk substation holds whatever bays
that station happens to have: Aldergate has a generation tie and no
reactive plant, Wyndham has a capacitor bank, Kessler has neither, and
Thorne has both a generation tie and a shunt reactor. Splitting that
into four types would produce four types with one instance each and
would say nothing true about the equipment — the stations are the same
kind of station.

The two warnings that were **not** left standing were real structural
differences, and both were split into separate types per the spec's
other branch: `transformer_bay` became `autotransformer_bay` (holding an
autotransformer) and `transformer_bay` (holding a power transformer),
and `reactive_bay` became `capacitor_bay` and `reactor_bay`. Likewise
`monitored_breaker` and `sf6_breaker` are two types from the start,
because only the monitored positions have trip-coil and mechanism
components.

---

## Browser check, and one scale note

Checked in headless Chromium against a bundled build, with no console
errors in any of the flows: model switch, Now strip, Attention list and
grouping, Investigate (Trend with the real `primaryProperty` series, the
evidence timeline and the time scrubber), the Operator Assets tree down
all six levels, Related Assets cards, the All Assets diagram, and the
Configurator's Types list, type previews and Assets tree.

**Scale note worth knowing before the next pack.** At 386 assets and 206
relationship edges, the All Assets diagram lays out **386 nodes and 591
edges** (the 206 relationships plus containment) and is ready in about
**8.9 s**, against the roughly 4.3 s the spec (§7) measured for a
synthetic 389-asset pack. The difference is the relationship count, not
the asset count — this pack has more edges than any other, which is the
point of it. It renders and stays responsive, but it sits at the top of
the §7 budget, and a denser network than this one should plan on hiding
device- and component-level assets from that view by default.
