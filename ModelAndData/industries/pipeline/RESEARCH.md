# Natural gas transmission pipeline — research brief (Lodestar Pipeline)

Industry pack `pipeline`, built to `INDUSTRY_PACK_SPEC.md` v2. Everything the
generator does is traceable to a section here, and every scenario in
`SCENARIOS.md` maps to a failure mode in §5. Numbers in brackets are
sources in §7; a few operating details that are standard industry practice
but not tied to one source are marked *(practice)*.

## Choices (Amy's answers to spec §0)

- **Industry:** an **interstate natural gas transmission mainline**: a
  310-mile, 36-inch line (MAOP 1,000 psig) with two receipt meter
  stations, three compressor stations, mainline valves and cathodic
  protection along four line segments, two city gates, a power-plant
  delivery and an end-of-line interconnect.
- **Names:** you picked "you choose". The pipeline is **Lodestar
  Pipeline**. Stations run west to east: Harlow Receipt, Wren, Sable Ridge
  Receipt, Bexley City Gate, Kettle Creek, Halcyon Point Delivery, Ashby,
  Tolland City Gate, Marlow Interconnect. The power-plant delivery feeds
  **Halcyon Point**, the plant in the `ccgt` pack. Its gas take follows
  the ccgt plant's own day: the fuel heater trip at 08:35–09:45, then the
  AGC ramp for the afternoon peak.
- **What it shows off: a long series chain.** Wind is wide (many similar
  turbines) and ccgt is deep (6 levels, many layers). This pack is
  **geographic and serial**. Gas moves station → segment → station, so a
  cause in the west shows up as a symptom 100–300 miles east, 15–60 minutes
  later. The chain also mixes very different **kinds of unit**: receipt
  meters, line segments, compressor stations, city gates, a power plant
  delivery and an interconnect, side by side in one Now strip.
- **Audience focus:** **throughput and fuel.** Headline KPIs are receipts
  and deliveries against schedule, line pack, and compressor fuel.
  Scenarios cover a receipt shortfall, a delivery restriction that packs
  the line, a hidden fuel loss, and a shipper imbalance under an OFO.
  Surge control and dry gas seals, the two compressor topics this audience
  recognises, each get a scenario.
- **Timeline:** the spec default, **2026-08-28, 08:00–14:05 at 5-minute
  steps** (74 points). It's the same demo day as ccgt, so the two packs'
  Halcyon Point stories line up. Pipeline SCADA polls much faster than
  5 minutes, but 5-minute averages are what a gas controller trends.
- **Units:** US customary, as a US gas control room shows them: MMscf/d,
  MMscf, psig, °F, hp, lb/MMscf.

## 1. Process overview

Processing plants and field gathering systems deliver pipeline-quality gas
into the mainline at **receipt meter stations**. There it is measured
for custody transfer (multipath ultrasonic meters, AGA Report 9) and its
quality checked: gas chromatograph for heating value and composition,
moisture and H₂S analyzers [1][6][7].

Friction bleeds off pressure as gas moves, so **compressor stations**
every 50–100 miles boost it back up [1][2]. Transmission lines typically
run at 500–1,500 psig [1][2]. Lodestar runs at about 780 psig suction
and 950–975 psig discharge, under its 1,000 psig MAOP.

A station:

- takes gas off the line through an inlet scrubber or filter/separator;
- compresses it in parallel **compressor units**. Each unit is a
  gas-turbine-driven centrifugal compressor or a gas-engine-driven
  reciprocating compressor, and some stations use electric motors;
- cools it in fin-fan **aftercoolers** before it goes back into the line,
  keeping it under the ~120 °F pipeline temperature limit [6];
- burns **fuel gas taken from the line** to run the drivers. Pipelines
  use about **2–3% of throughput** as compressor fuel, and fuel rises
  steeply with flow [4][18].

Between stations the pipe itself is storage: **line pack**. Operators
"pack" the line (receipts above deliveries, pressure rising) and "draft"
it (the reverse) to ride through imbalances. They must stay under MAOP
and above the minimum pressure customers need [1][12].

Gas leaves at delivery points:

- **City gate stations** hand gas to local distribution companies. They
  meter it, heat it in an indirect water-bath **line heater**, cut the
  pressure through worker/monitor **regulator runs** and **odorize** it
  with mercaptan [2]. The heater is there because a pressure cut chills the
  gas by about **6–8 °F per 100 psi** (Joule-Thomson), and a regulator
  taking 850 psig down to 300 psig would otherwise run below freezing [8].
- **Power-plant laterals** deliver fuel gas; the plant regulates it.
- **Interconnects** hand gas to another pipeline.

Mainline valves (MLVs), increasingly remote-controlled rupture-mitigation
valves, sit along each segment. Rectifiers on the cathodic protection (CP)
system keep the pipe polarised against external corrosion [9][14].

Commercially, shippers **nominate** quantities by cycle (Timely, Evening,
ID1, ID2, ID3) on a **gas day** that starts at 9:00 a.m. Central [13][19].
Scheduled quantities are confirmed at receipts and deliveries. On tight
days the pipeline can issue an **Operational Flow Order (OFO)** that
narrows the imbalance tolerance *(practice)*.

**Lodestar sizing used:**

| | Value |
|---|---|
| Length / diameter / MAOP | 310 mi / 36 in / 1,000 psig |
| Receipts | Harlow ~905 MMscf/d (plant tailgate), Sable Ridge ~181 MMscf/d (field tie-in) |
| Deliveries | Bexley ~130–150, Halcyon Point ~84–105, Tolland ~90, Marlow ~735 scheduled |
| Compressor stations | Wren 3 × 15,000 hp gas turbine (2 run, 1 standby); Kettle Creek 5 × 6,500 hp gas-engine recip (4 run, 1 standby); Ashby 2 × 15,000 hp gas turbine (both run) |
| System line pack | ~740–750 MMscf |
| Compressor fuel | ~9–11 MMscf/d, ~1% of throughput (on the low side of the 2–3% average [4], because this is a short, lightly loaded line) |

The gas-turbine units are sized after a Solar Titan 130 class machine
(23,470 hp ISO, 6,800 Btu/hp-h [5]), derated to 15,000 hp site rating.
Heat rate rises at part load. Centrifugal compressor efficiency is taken
as 75–88% [4]; the model uses about 82%.

## 2. The natural hierarchy

Pipeline companies organise a system geographically: **system → area or
district** (the field organisation with its own technicians) →
**facility** (a station, or a segment between stations with its valve
sites) → **equipment** → **component**. Lodestar uses those levels:

| Level (`assetLevel`) | What it is | Lodestar |
|---|---|---|
| `system` | the pipeline | Lodestar Pipeline (1) |
| `district` | operating district | West, Central, East (3) |
| `facility` | a station or a line segment — **the unit of operation** | 13: 2 receipts, 4 segments, 3 compressor stations, 2 city gates, 1 power delivery, 1 interconnect |
| `equipment` | named equipment at the facility | meter runs, MLVs, rectifiers, compressor units, scrubbers, aftercoolers, heaters, regulator runs, odorizers, analyzers |
| `component` | parts of a compressor unit operators name | gas turbine, centrifugal compressor, dry gas seals, lube oil console; gas engine, compressor frame |

**Where branches really differ** (spec §3.1):

- **Facilities are eight different types at one level.** A receipt
  station has meter runs and analyzers. A segment has three MLVs and two
  rectifiers. A city gate has a heater, regulator runs and an odorizer.
  The Halcyon Point delivery is a filter/separator and one meter run.
- **Two receipt types:** the plant tailgate (3 × 16-in meter runs, a GC
  and a moisture/H₂S analyzer) and the field tie-in (2 × 8-in runs and an
  analyzer, no GC). Their flows differ by 5×, so they get different flow
  keys and gauges (§3.3).
- **Two compressor-station types:** Wren and Ashby hold turbine /
  centrifugal units (4 components each: turbine, compressor, dry gas seals,
  lube oil). Kettle Creek holds engine / reciprocating units (3
  components: engine, frame and cylinders, lube oil). The station's own
  properties are identical, but its children are different kinds of
  machine, so per spec §3.1 they're two types. That also keeps the
  Configurator's type-level Related Assets honest: a turbine station
  never lists recip units.
- **Standby equipment** reads zero flow and power, as a real standby unit
  does: Wren CU-3, and Kettle Creek CU-5 until it's started at 12:15.
  Ashby has no spare, which is why its two units fall into recycle when
  its throughput is cut.
- **Shared kits:** `lube_oil_console` and `filter_separator` are shared
  across branches because they're the same equipment. The meter-run
  diagnostics (speed-of-sound spread, gain) are shared between the 16-in
  and 8-in run types.

**Counts:** 111 assets, 29 asset types, 13 units, 5 levels. The
`operating_district` type holds different facility mixes. It's a
geographic container, so the validator warning is expected (spec §3.1).

## 3. The unit of operation

`unitLevel: "facility"`. Gas controllers work station by station and
segment by segment: they set a station's suction or discharge control and
its unit line-up, watch each segment's pressures and line pack, and
confirm each receipt and delivery against schedule. A tile for every
facility turns the Now strip into the pipeline's schematic, west to east.
13 tiles is well inside the ≤ 24 budget.

## 4. KPIs and properties

| Type | Properties (unit) | Operator watches most |
|---|---|---|
| Pipeline system | total receipts, total deliveries (MMscf/d), system line pack (MMscf), line pack change (MMscf/h), compressor fuel (MMscf/d) | line pack and its rate of change |
| District | line pack, compressor fuel | line pack |
| Receipt station | receipt flow, scheduled receipt, receipt pressure | flow vs schedule |
| Line segment | inlet and outlet pressure, flow, line pack, MAOP (static) | inlet pressure vs MAOP, outlet pressure |
| Mainline valve | line pressure at the valve, pressure rate of change (psi/min), valve position | rate of change (rupture detection) |
| CP rectifier | output V and A, pipe-to-soil potential (mV) | pipe-to-soil (≤ −850 mV criterion [14]) |
| Compressor station | suction, discharge, throughput, power (hp), fuel, compression ratio | suction and discharge |
| Turbine / centrifugal unit | compressor flow, power, fuel, recycle valve command, speed, rating | flow and recycle |
| Gas turbine | gas producer speed, T5 temperature, inlet filter DP | T5 |
| Centrifugal compressor | discharge temperature, shaft vibration, polytropic efficiency | vibration |
| Dry gas seals | primary vent flow (scfm), seal gas filter DP, seal gas supply DP | primary vent flow |
| Recip unit | flow, power, fuel, engine speed, rating | flow |
| Gas engine | exhaust temperature, jacket water temperature, detonation events per hour | detonation |
| Compressor frame | cylinder discharge temperature, max valve-cover temperature deviation, frame vibration, rod load | valve temp deviation, vibration |
| Meter run | flow, speed-of-sound path spread (ft/s), transducer gain (dB) | flow |
| GC / analyzer | HHV, CO₂, relative density; water (lb/MMscf), H₂S (gr/100 scf), HC dew point | HHV, water |
| City gate | delivery flow, inlet and outlet pressure | outlet pressure |
| Line heater / regulator run / odorizer | bath temperature, gas outlet temperature, firing rate; run flow, outlet gas temperature, travel; odorant rate, tank level | heater outlet temperature; regulator outlet temperature |
| Power-plant delivery | delivery flow, scheduled quantity, gas-day imbalance, delivery pressure | imbalance |
| Interconnect | delivery flow, scheduled quantity, delivery pressure | flow vs schedule |

**Where the normal ranges come from:**

- **Tariff gas quality** [6]: water ≤ 4–7 lb/MMscf (Lodestar uses 7);
  H₂S ≤ 0.25 gr/100 scf; CO₂ ≤ 2–3%; HHV 950–1,200 Btu/scf; HC dew
  point ≤ 15 °F; temperature ≤ 120 °F. Lodestar's normal is about
  3 lb/MMscf water, 0.06–0.11 gr H₂S, 0.86% CO₂ and 1,036 Btu/scf.
- **Ultrasonic meters** [7]: path speeds of sound should agree within
  about 1.5 ft/s. Gain rises with velocity and with transducer fouling.
- **Dry gas seals** [10]: primary vent flow is the health signal. It
  alarms high and trips at high-high; a leaking seal raises it. Lodestar
  uses a normal of about 1.3 scfm, alarm 6.0 and trip 8.0 *(illustrative
  setpoints; real ones are seal-specific)*.
- **Recip valves** [11]: a leaking suction or discharge valve heats the
  gas in its valve pocket. Valve-cover temperature deviation is the early
  signal, before capacity loss or vibration.
- **Rupture detection** [9]: an unplanned pressure loss of 10% or more
  within 15 minutes is a rupture indicator. Rupture-mitigation valves must
  be closed within 30 minutes of identification. RMV spacing is ≤ 8 mi in
  Class 4 locations and ≤ 15 mi in Class 3.
- **Joule-Thomson** [8]: 6–8 °F per 100 psi of pressure cut. The model
  uses 7 °F.
- **Cathodic protection** [14]: −850 mV (CSE) pipe-to-soil criterion;
  rectifiers inspected six times a year at intervals of up to 2½ months.
  Lodestar reads −1,040 to −1,145 mV.
- **Odorization:** readily detectable at one-fifth of the lower explosive
  limit (49 CFR 192.625); about 1 lb of odorant per MMscf is a common
  injection rate *(practice)*.

**Headline KPIs and how they roll up** (declared in `properties.json`):

- **System line pack** = **sum** of the four segments' line pack; each
  **district** sums its own segments.
- **Line pack change rate** = Δ system line pack × 12 (MMscf/h). The
  gas controller's packing/drafting number (formula).
- **Compressor fuel:** system and district = **sum** of station fuel;
  station fuel = Σ unit fuel (formula, because turbine and recip units use
  different keys).
- **Station throughput** is the station meter. It is **not** the sum of
  unit flows whenever a unit recycles (formula). The LSIT09 scenario
  depends on this difference.
- **Meter-station flows** = **sum** of their meter runs. City gate
  delivery = **sum** of its regulator runs.
- **Total receipts and deliveries:** formulas across differently keyed
  station types.
- **Gas-day imbalance** = Σ (actual − scheduled) × Δt since the 09:00
  gas-day start (formula). Before 09:00 it shows the prior gas day.
- **Line pack itself** integrates inflow − outflow − fuel for each
  segment. Average pressure = line pack / (0.00274 MMscf/psi-mile ×
  miles). Inlet and outlet pressures straddle that average according to
  the general flow equation, p₁² − p₂² ∝ L·Q² *(practice)*.

## 5. Failure modes

| # | Asset | Cause | First symptom | Spreads to | Confirmed by | Usual fix | Timescale | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | Receipt (plant tailgate) | Upstream plant trip (residue compressor, power) | Receipt flow drops below nomination | Segment drafts; downstream stations cut throughput or recycle; line pack falls | Plant confirmation; meter vs nomination | Plant restart; shipper make-up | Minutes–hours | [1][12] |
| 2 | Field receipt | Producer dehydration (glycol) failure | Water content rising; separator liquids | Hydrates and freeze-offs at regulators; internal corrosion | Moisture analyzer; separator liquid sample | Producer repair; refuse non-conforming gas | Hours | [6] |
| 3 | MLV pressure transmitter | Wiring or moisture fault | Erratic pressure; false rate-of-change (rupture) alarm | Risk of a false rupture-valve closure | Neighbouring MLVs and line balance flat; field check | Replace transmitter | Minutes | [9] |
| 4 | Line segment | Rupture or large leak | Pressure loss ≥ 10% in 15 min at several valves | Downstream pressures and deliveries collapse | Multiple sites plus a flow imbalance; public report | RMV closure within 30 min; isolate | Minutes | [9] |
| 5 | Turbine unit, dry gas seal | Face wear or contamination (liquids, particles), separation-seal problems | Primary vent flow rising at steady speed | Seal gas consumption; trip at high-high vent flow; gas release | Vent flow trend vs sister unit; secondary vent | Swap to standby; replace cartridge | Days–weeks | [10] |
| 6 | Turbine unit, anti-surge valve | Seat erosion; actuator not fully closing | More compressor flow and fuel at the same station throughput | Fuel cost; valve erodes further | Recycle-line temperature, acoustic check; unit flow vs station meter | Stroke-test and repair | Weeks | [15] |
| 7 | Compressor station controls | Discharge-pressure control interacting with anti-surge control at low flow | Growing pressure and flow oscillation | Surge trips; pressure swings downstream | Control modes and trends | Base-load one unit; retune; change control mode | Minutes | [15] |
| 8 | Recip compressor valve | Broken plate or spring; fatigue; liquids | Valve-cover temperature deviation | Capacity loss, rod-load change, vibration, trip | Valve temperatures, pV analysis | Replace valve | Minutes–days | [11] |
| 9 | Gas engine | Detonation (hot intake air, ignition wear, air/fuel drift) | Knock events; timing retard and load shed | Piston and head damage; engine shutdown | Per-cylinder knock data | Load trim; repair | Hours–weeks | *(practice)* |
| 10 | Compressor scrubber | Liquid slug (pigging, carry-over) | Scrubber level high | Unit or station shutdown on high-high level; compressor damage | Level, dump-valve cycling | Drain; slow the pig | Minutes | [16] |
| 11 | City gate line heater | Flame failure (pilot, flame rod, fuel) | Bath temperature falling | Regulator outlet near freezing; pilot icing; regulator hunting; monitor takeover | Burner status; temperatures | Relight; repair flame safeguard | Minutes–hours | [8][17] |
| 12 | Delivery (interconnect or LDC) | Downstream restriction | Delivery below schedule | Line packs toward MAOP, from the end of line backwards | Delivery vs schedule; segment pressures | Hold compressors back; cut receipts at the next cycle | Hours | [12][13] |
| 13 | Power-plant delivery | Take above schedule (dispatch changed, nomination not) | Imbalance growing | OFO penalties; line drafting | Imbalance vs tolerance | Renominate; trade the imbalance | Hours | [13][19] |
| 14 | CP rectifier | AC power loss or failure | Output 0 A | Pipe-to-soil drifts less negative over days | Rectifier inspection | Repair | Days | [14] |
| 15 | Meter run | Transducer fouling or failure | SOS spread up; gain up | Measurement error at custody transfer | AGA 9 diagnostics | Clean or replace transducer | Weeks | [7] |

**Assets with no relationship edges, and why:**

- **The pipeline system and the three districts:** pure containers;
  containment already shows them.

Every facility, equipment item and component has at least one edge. The
edges run on 8 layers: `gas_flow` (the mainline and station yards),
`fuel_gas`, `seal_gas`, `lube_oil`, `power` (shafts), `cathodic_protection`
(rectifier → test stations at the valve sites), `chemical_dosing`
(odorant) and `sample` (analyzers). There are two real cycles: each
station's anti-surge recycle (aftercooler → scrubber), and the mainline
itself, which runs segment → station → segment at facility level and
MLV → scrubber → unit → aftercooler → MLV at equipment level.

## 6. Normal-operation context

- **Operating mode:** every facility is `STEADY`, except Ashby, which is
  `CONTROLLED_HOLD` on a lowered discharge limit from 12:50. Wren runs 2
  of 3 units and Kettle Creek 4 of 5 all day (standby CU-5 replaces the
  tripped CU-3 from 12:15); Ashby runs both units.
- **Commercial day:** gas day from 09:00. An **OFO** is in effect (a hot
  day with a high power burn; ±2% daily imbalance tolerance). ID1 and ID2
  cycles have passed by "now"; ID3 closes at 17:00 and takes effect at
  20:00 [13].
- **Products:**
  - receipts: "Residue gas receipt" / "Field gas receipt"
  - segments: "Transport + line pack"
  - stations: "Compression"
  - city gates: "LDC delivery (odorized)"
  - Halcyon Point: "Power-plant fuel"
  - Marlow: "Interconnect delivery"
- **Routine work in the work list:**
  - shift turnover and gas-control briefing
  - aerial right-of-way patrol
  - rectifier readings (49 CFR 192.465 [14])
  - annual MLV inspection and partial stroke (49 CFR 192.745 [20])
  - odorant sniff test (49 CFR 192.625)
  - monthly ultrasonic meter diagnostics review [7]

## 7. Sources

1. INGAA, *The Interstate Natural Gas Transmission System: Scale, Physical Complexity and Business Model* — https://ingaa.org/wp-content/uploads/2010/08/10751.pdf
2. Pipeline Safety Trust, *Pipeline Basics & Specifics About Natural Gas Pipelines* (2019) — https://pstrust.org/wp-content/uploads/2019/03/2019-PST-Briefing-Paper-02-NatGasBasics.pdf
3. Penn State Extension, *Understanding Natural Gas Compressor Stations* — https://extension.psu.edu/understanding-natural-gas-compressor-stations
4. INGAA, *Interstate Natural Gas Pipeline Efficiency* — https://ingaa.org/wp-content/uploads/2010/10/10929.pdf
5. Solar Turbines, Titan 130 gas compressor set — https://www.solarturbines.com/en_US/products/gas-compressor-packages/titan-130.html
6. TC Energy, *Gas Quality Specifications Fact Sheet* — https://www.tccustomerexpress.com/docs/Gas_Quality_Specifications_Fact_Sheet.pdf
7. ASGMT, *Ultrasonic Meter Diagnostics — Basic* — https://asgmt.com/wp-content/uploads/2016/02/072_.pdf
8. Kimray, *The Joule-Thomson Effect: What It Is and How It Affects Oil and Gas* — https://kimray.com/training/joule-thomson-effect-what-it-and-how-it-affects-oil-and-gas
9. PHMSA final rule, *Requirement of Valve Installation and Minimum Rupture Detection Standards* (Federal Register, 8 Apr 2022) — https://www.federalregister.gov/documents/2022/04/08/2022-07133/pipeline-safety-requirement-of-valve-installation-and-minimum-rupture-detection-standards
10. Turbomachinery Magazine, *Guidelines for dry gas seal troubleshooting* — https://www.turbomachinerymag.com/view/tips-for-dry-gas-seal-seal-troubleshooting ; *Dry gas seal failure modes* — https://www.turbomachinerymag.com/view/dry-gas-seal-failure-modes
11. Digital Refining, *Reciprocating compressor suction and discharge valve monitoring* — https://www.digitalrefining.com/article/1000751/reciprocating-compressor-suction-and-discharge-valve-monitoring
12. Energy Knowledge Base, *Line pack* — https://www.energyknowledgebase.com/post/line-pack
13. PG&E Pipe Ranger, *Five Nomination Cycles* — https://www.pge.com/pipeline/en/reference-library/facts-and-faqs/facts/nom-cycle.html
14. 49 CFR 192.465, External corrosion control: monitoring and remediation — https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-D/part-192/subpart-I/section-192.465 ; Appendix D to Part 192, CP criteria — https://www.govinfo.gov/app/details/CFR-2025-title49-vol3/CFR-2025-title49-vol3-part192-appD
15. *A review of anti-surge control systems of compressors* (Heliyon, 2023) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10480680/ ; Turbomachinery Magazine, *TPS 2024: compressor anti-surge control improves energy and carbon performance* — https://www.turbomachinerymag.com/view/tps-2024-compressor-anti-surge-control-improves-energy-carbon-performance
16. Kimray, *How a Gas Compressor Station Works* — https://kimray.com/training/how-gas-compressor-station-works ; Oil & Gas Journal, *Liquids entrainment: changing operating conditions lead to compressor damage* — https://www.ogj.com/home/article/17221442/special-report-liquids-entrainment1-changing-operating-conditions-lead-to-compressor-damage
17. Wattco, *Natural gas heating to prevent freezing after throttling* — https://www.wattco.com/casestudy/electric-heating-of-natural-gas-to-prevent-freezing-after-throttling/
18. FERC, *Fuel Retention Practices of Natural Gas Companies* (Federal Register, 1 Oct 2007) — https://www.federalregister.gov/documents/2007/10/01/E7-19386/fuel-retention-practices-of-natural-gas-companies
19. NAESB, gas day standard (9 a.m. to 9 a.m. Central) — https://www.naesb.org/pdf/idaywk3.pdf
20. 49 CFR 192.745, Valve maintenance: transmission lines — https://www.law.cornell.edu/cfr/text/49/192.745
