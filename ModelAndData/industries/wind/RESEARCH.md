# Wind — research brief (Boreas Ridge)

Industry pack `wind`, built to `INDUSTRY_PACK_SPEC.md` v2. Everything the
generator does is traceable to a section here, and every scenario in
`SCENARIOS.md` maps to a failure mode in §5.

## Defaults chosen (Amy wasn't asked separately)

- **Industry:** onshore wind farm, operated from a remote control room
  over SCADA. Chosen for being automation-heavy rather than manufacturing:
  many identical remote assets, a supervisory control layer, and
  condition monitoring instead of line throughput.
- **Names:** site **Boreas Ridge**; turbines **WTG-01 … WTG-24**.
- **What it shows off:** a **wide, uneven, 5-level** model with **two
  turbine generations** that differ in structure (a geared machine has a
  gearbox and a DFIG generator, a direct-drive machine has neither), plus
  leaf assets directly under the site (substation, met mast). None of the
  three earlier models has any of these.
- **Timeline:** **14 January 2026, 00:00–14:00, 10-minute steps**
  (85 points). The 10-minute average is the standard SCADA reporting
  interval for wind turbines, and a winter day is needed for the icing
  scenarios to be physically plausible. The default 2026-08-28 shift from
  the spec would have ruled icing out.

## 1. Process overview

Wind turns the rotor; the rotor's mechanical power reaches the generator,
either through a gearbox (geared machines) or directly (direct-drive
machines). A power converter conditions the output, and a pad-mount
transformer at each tower base steps it up from 690 V to the 34.5 kV
collector voltage. Buried collector feeders gather strings of turbines
and bring them to the collector substation. There, a main power
transformer steps up to transmission voltage at the point of
interconnection (POI) with the grid.

The IPST 2011 collector-system design study describes exactly this
layout: a 75 MW farm with **four radial 34.5 kV feeders carrying 7, 8, 9
and 9 turbines**, 2.3 MW units with 690 V / 34.5 kV step-up transformers,
and a 230/34.5 kV collector substation [1]. Boreas Ridge follows it
closely.

## 2. The natural hierarchy

| Level (`assetLevel`) | What it is | Boreas Ridge |
|---|---|---|
| `site` | The wind farm | Boreas Ridge (1) |
| `circuit` | What hangs directly off the site: collector feeders, the collector substation, the met mast | Feeder 1–4, Collector Substation, Met Mast |
| `turbine` | A wind turbine generator (WTG) — **the unit of operation** | 24 WTGs |
| `subsystem` | Major turbine systems: rotor, drivetrain / main shaft, generator, converter, yaw, pad transformer | 6 per turbine |
| `component` | Parts operators and technicians name individually | pitch system, bearings, gearbox, cooling fan, yaw drive |

**Where branches really differ** (spec §3.1):

- **Phase 1 (Feeders 1–3): 19 × 2.3 MW geared machines** — rotor →
  drivetrain (main bearing, gearbox, HS bearing) → DFIG generator
  (generator bearing, cooling fan).
- **Phase 2 (Feeder 4): 5 × 3.3 MW direct-drive machines** — rotor →
  main shaft (main bearing) → PM generator (cooling fan). There is no
  gearbox and no high-speed shaft.

These are therefore two turbine **types**, and their drivetrain and
generator subsystems are different types too. The feeder is one type
even though Feeder 4 holds different turbines; the validator warns about
that, which is expected (spec §3.1).

**Counts:** 1 site, 4 feeders with **6, 7, 6 and 5** turbines, 1
substation, 1 met mast → **328 assets**, inside the spec's ≤ 400 budget.
24 turbines is exactly the ≤ 24 unit budget for the Now strip, so a
larger farm (real ones often have 50–150) would be shown by grouping
rather than one tile per turbine.

**Leaf assets at level 2:** the substation and the met mast have no
children. They show a leaf at a shallow level next to deep branches.

## 3. The unit of operation

The **turbine**. Control-room operators start, stop, reset, curtail and
dispatch technicians per turbine, and turbine state (running / stopped /
maintenance) is the primary SCADA overview. `unitLevel: "turbine"`.

## 4. KPIs and properties

Signals follow what turbine SCADA reports as 10-minute averages.
Temperatures are the backbone of drivetrain condition monitoring from
SCADA [2][3]. Gearbox bearings, oil sump, generator bearings and stator
windings are the standard temperature points [4].

| Type | Properties (unit) | Operator watches most |
|---|---|---|
| Wind farm | farm output (kW), capacity factor (%), availability (%) | output, availability |
| Collector feeder | feeder output (kW), feeder current (A), availability (%) | output |
| Collector substation | export power (kW), POI voltage (kV), reactive power (kvar), main transformer oil temperature (°C) | export vs. dispatch limit |
| Met mast | reference wind speed (m/s), wind direction (°), ambient temperature (°C), relative humidity (%) | wind, temperature + humidity (icing) |
| Turbine (both) | active power (kW), nacelle wind speed (m/s), power-curve performance (%), availability (%), rated power (kW, static) | power, performance |
| Rotor | rotor speed (rpm), blade pitch angle (°) | both |
| Pitch system | backup battery voltage (V), pitch motor current (A), blade pitch deviation (°) | battery voltage |
| Drivetrain / main shaft | drivetrain vibration, max of its bearings (mm/s) | — |
| Main / HS / generator bearing | bearing temperature (°C), vibration (mm/s) | temperature |
| Gearbox | oil temperature (°C), oil pressure (bar), oil debris count (particles/h) | oil temperature, debris |
| DFIG generator | generator speed (rpm), stator winding temperature (°C) | winding temperature |
| PM generator | stator winding temperature (°C), coolant temperature (°C) | winding temperature |
| Cooling fan | fan motor current (A) | current (0 A = stopped) |
| Converter | converter temperature (°C), DC-link voltage (V), cabinet humidity (%) | cabinet humidity |
| Yaw system | measured yaw error (°), nacelle direction (°) | yaw error |
| Yaw drive | yaw motor current (A) | — |
| Pad transformer | oil temperature (°C), load (%) | oil temperature |

**Headline KPIs and how they roll up** (spec §3.5, declared in
`properties.json`):

- **Availability.** Time-based availability = available hours / total
  hours; production-based availability = energy produced / energy
  possible. The two can differ by up to about 2 % [5]. Boreas Ridge uses
  time-based availability, cumulative since 00:00. Feeder and farm
  availability are the **mean** of their turbines.
- **Output:** feeder and farm output are the **sum** of turbine active
  power. Export is the feeder sum less about 2.5 % collector and main
  transformer losses (a formula).
- **Capacity factor** = farm output / installed capacity (60.2 MW).
- **Power-curve performance** = actual power / power expected at the
  turbine's own measured wind speed. It is the standard SCADA
  underperformance indicator, and the one both icing detection and
  yaw-misalignment analysis rely on [6][7].
- **Drivetrain vibration** = the **max** of its bearings' vibration.

Normal values are simplified from typical 2–3 MW machines: rated at
11.5–12.5 m/s, cut-in about 3 m/s; HS bearings 70–80 °C at full load and
main bearings 35–45 °C; stator windings around 110 °C at full load. The
SCADA Miner note puts common warning levels around 80 °C for bearings in
summer, and notes a damaged bearing may only reach 65 °C in winter [4].
That's why the HS-bearing scenario is framed **relative to siblings**, not
against a fixed limit.

## 5. Failure modes

| # | Asset | Cause | First symptom | Spreads to | Confirmed by | Usual fix | Timescale | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | HS bearing (geared) | Surface fatigue / spalling | Bearing temperature rising against load; oil debris rising | Gearbox oil temperature, vibration; eventually the gearbox | Borescope, oil analysis | Planned bearing replacement | Weeks–months | [2][3][8] |
| 2 | Main bearing | Wear, lubrication | Temperature and vibration trend | Drivetrain | Vibration analysis | Relubrication / replacement | Months | [3] |
| 3 | Generator cooling fan | Motor or breaker trip | Fan current → 0 A | Stator winding temperature, thermal derate | Fan current, reset result | Reset breaker / replace motor | Minutes–hours | [9] |
| 4 | Pitch backup battery | End of life, cold | Battery voltage low; failed pitch battery test → safety stop | Repeated stops; blades may not feather on grid loss | Battery test | Replace pack | Days | [10] |
| 5 | Pitch system (hydraulic) | Accumulator pre-charge loss, valve faults | Pitch deviation, slow response | Rotor loads | Pitch test | Recharge / replace accumulator | Days | [10][11] |
| 6 | Converter | Condensation / humidity in the cabinet (the dominant cause in field data, more than thermal cycling) | Phase-module fault trip, often at part load after idle periods | Turbine stop | Fault log, inspection | Restart after heating; inspect module | Minutes–days | [12] |
| 7 | Pad-mount transformer | Internal fault (insulation) | Oil temperature rising without matching load; pressure relief | Feeder breaker trip → every turbine on that feeder | Oil sample, field check | Isolate, replace transformer | Hours–weeks | [1][13] |
| 8 | Collector feeder cable | Splice or cable fault | Feeder breaker trip | All turbines on the feeder | Patrol, fault location | Repair splice | Hours–days | [1] |
| 9 | Nacelle anemometer | Icing, heater failure | Wind reading low while power stays normal | Yaw control, cut-out logic, performance metrics | Met-mast comparison | Heater reset | Hours | [7][14] |
| 10 | Wind vane / yaw | Static offset (e.g., after a vane replacement) | Power below curve with measured yaw error ≈ 0 | Energy loss (∝ cos² of the misalignment: ~0.5 % at 4°, ~2.5 % at 9°) | Vane alignment check, LiDAR | Correct the offset | Until found | [6] |
| 11 | Blades | Rime/glaze icing below 0 °C in cloud or fog | Power below curve across exposed turbines | Energy loss; ice throw risk | Weather + power-curve pattern | Wait, de-ice, access restriction | Hours–days | [7][14] |
| 12 | Grid / dispatch | Curtailment instruction from the grid operator | Dispatch limit below available power | Farm output | Plant controller | Enter setpoint | Minutes | [15][16] |
| 13 | Yaw drive | Motor or brake wear | Current spikes, slow yawing | Yaw error | Current trend | Repair drive | Days | [11] |
| 14 | Gearbox oil system | Pump or filter | Oil pressure low | Gearbox temperature | Pressure trend | Filter or pump | Days | [3] |

Pitch systems are the single largest contributor to turbine failures,
at about 22 % of failures and around 0.55 failures per turbine per year
[10]. Converters rank second in both failure frequency and downtime in
RELIAWIND [12].

## 6. Normal-operation context

- **Operating modes** used here: `STEADY`, `MAINTENANCE` (planned work),
  `STOPPED` (isolated after a fault), and `CURTAILED` once the plant
  controller setpoint is entered. `CURTAILED` is a wind-specific mode with
  no color yet (spec §6.6).
- **Product:** "Grid export".
- **Routine work:** shift handover and SCADA review; permits to work and
  LOTO before climbs; planned maintenance (gearbox oil changes); met-mast
  sensor checks; substation inspections; responding to dispatch
  instructions [15][16].

## 7. Sources

1. Design Studies for a Wind Farm Collector System (IPST 2011) — https://www.ipstconf.org/papers/Proc_IPST2011/11IPST110.pdf
2. Prognosis of Wind Turbine Gearbox Bearing Failures using SCADA (PHM Society) — https://papers.phmsociety.org/index.php/phmconf/article/download/1292/862
3. Wind Turbine Drivetrain Condition Monitoring through SCADA-Collected Temperature Data (Energies 2023) — https://doi.org/10.3390/en16093614
4. Wind Turbine Temperature Performance — Temperature Constraints (SCADA Miner) — https://www.scadaminer.com/wind-turbine-temperature-performance/
5. DNV GL, Definitions of Availability Terms for the Wind Industry (2017) — https://www.ourenergypolicy.org/wp-content/uploads/2017/08/Definitions-of-availability-terms-for-the-wind-industry-white-paper-09-08-2017.pdf ; IEC 61400-26-1 — https://standards.globalspec.com/std/13327126/iec-61400-26-1
6. What is Yaw Misalignment? (WindESCo) — https://www.windesco.com/blog/what-is-yaw-misalignment ; Wind Turbine Systematic Yaw Error (Energies 2020) — https://www.mdpi.com/1996-1073/13/9/2351
7. IEA Wind Task 19 ice-loss method — https://iea-wind.org/task19/t19icelossmethod/ ; Wind Turbine Blade Icing Detection with SCADA Data (IEEE) — https://ieeexplore.ieee.org/document/10033566/
8. Fault early warning of wind turbine gearbox (Wind Energy 2021) — https://onlinelibrary.wiley.com/doi/full/10.1002/we.2604
9. Fault detection of a wind turbine generator bearing using interpretable ML (Frontiers 2023) — https://www.frontiersin.org/journals/energy-research/articles/10.3389/fenrg.2023.1284676/full
10. Reliability of electrical and hydraulic pitch systems in wind turbines (Energy Reports 2023) — https://strathprints.strath.ac.uk/84315/1/Welgern_etal_ER_2023_Reliability_of_electrical_and_hydraulic_pitch_systems.pdf
11. Wind Turbine Pitch and Yaw System Maintenance Programs — https://oxmaint.com/industries/power-plant/wind-turbine-pitch-yaw-system-maintenance-programs
12. Exploring the Causes of Power-Converter Failure in Wind Turbines (Energies 2019) — https://www.mdpi.com/1996-1073/12/4/593
13. Proactive Monitoring: Generators, Power Converters and Transformers (WindESCo) — https://www.windesco.com/blog/proactive-monitoring-preventing-failures-in-wind-turbine-electrical-generators-power-converters-and-transformers
14. Wind turbines in icing conditions: performance and prediction (Adv. Sci. Res. 2011) — https://asr.copernicus.org/articles/6/245/2011/asr-6-245-2011.pdf
15. NREL, Wind and Solar Energy Curtailment: Experience and Practices — https://docs.nrel.gov/docs/fy14osti/60983.pdf
16. Active power control (Wind Energy — The Facts) — https://www.wind-energy-the-facts.org/active-power-control.html
