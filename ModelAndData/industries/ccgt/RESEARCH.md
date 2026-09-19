# Combined cycle — research brief (Halcyon Point)

Industry pack `ccgt`, built to `INDUSTRY_PACK_SPEC.md` v2. Everything the
generator does is traceable to a section here, and every scenario in
`SCENARIOS.md` maps to a failure mode in §5.

## Choices (Amy's answers to spec §0)

- **Industry:** a gas-fired **combined-cycle plant, one 2x1 block**: two
  F-class gas turbines (CTGs), two triple-pressure reheat HRSGs, one reheat
  condensing steam turbine (STG), plus common balance of plant (wet cooling
  tower, fuel gas yard, 345 kV switchyard).
- **Names:** site **Halcyon Point**; units CTG-1, CTG-2, HRSG-1, HRSG-2,
  STG-1, Circulating Water, Fuel Gas Yard, Switchyard.
- **What it shows off:** all three at once:
  - **Deep:** 6 levels (site → area → unit → system → equipment →
    component). Wind has 5; the legacy packs have 3–4.
  - **Uneven branches:** a CTG, an HRSG, the STG and the common-plant
    units each have a different structure. Leaves sit at the system,
    equipment and component levels (§2).
  - **Many relationship layers:** 9 layers (fuel gas, gas path, exhaust
    gas, steam, feedwater, cooling water, lube oil, power, chemical
    dosing), 96 edges. Edges cross branches (CTG → HRSG → STG → condenser
    → cooling tower, and HRSG → fuel gas heater), and there are real
    cycles: the water/steam loop and the circulating-water loop.
- **Audience focus:** **heat rate and availability.** Net heat rate and
  equivalent availability are the site's P1 KPIs, and most scenarios hit
  one of them (runback, efficiency drift, hidden steam-cycle loss,
  backpressure).
- **Timeline:** the spec default, **2026-08-28, 08:00–14:05 at 5-minute
  steps** (74 points). A hot late-August day works well here: rising
  ambient temperature is the main thing that lowers CCGT capability and
  raises heat rate, so the drivers in the data are real ones.
- **Units:** US customary (MW, °F, psig, inHgA, klb/h, Btu/kWh), as a US
  plant's DCS would show them.

## 1. Process overview

Each gas turbine runs a Brayton cycle: the compressor raises air pressure,
fuel gas burns in the dry low-NOx (DLN) combustor cans, and the turbine
drives both the compressor and a hydrogen-cooled generator. The ~1,100 °F
exhaust goes through a heat recovery steam generator (HRSG). The HRSG
raises HP, IP and LP steam, and reheats the cold reheat steam coming back
from the steam turbine [1]. An SCR catalyst in the HRSG gas path, fed with
aqueous ammonia, cuts NOx from about 9 ppm to about 1.5–2 ppm before the
stack [2][3].

The steam turbine is shared by both HRSGs (the "2x1"). HP steam expands
through the HP section, goes back to the HRSGs for reheat, and then passes
through the IP and LP sections to the condenser. The condenser rejects
heat to circulating water, which is cooled in an 8-cell mechanical-draft
wet cooling tower. Condensate pumps return water through the LP economizer
to the LP drums, and a boiler feed pump (BFP) on each HRSG feeds the IP and
HP drums [4].

A 2x1 steam turbine makes about half as much as the two gas turbines
together. In GE's 7HA.02 brochure, the GTs make 660 MW and the plant
976 MW in 2x1 [5]. Plant net heat rate for modern F/H-class 2x1 plants is
about 5,300–5,500 Btu/kWh on an LHV basis [6]. The US combined-cycle fleet
averages about 7,100 Btu/kWh on an HHV basis [7], and HHV ≈ 1.11 × LHV for
natural gas [8]. Halcyon Point is a slightly older F-class plant, so its net
heat rate is **about 6,300–6,450 Btu/kWh (HHV)** in the afternoon heat.

**Plant sizing used:**

| | Value |
|---|---|
| CTG rating (ISO, 59 °F) | 280 MW each |
| STG rating | 300 MW |
| Gross output at 95 °F | ~ 722 MW |
| Auxiliary load | ~ 2.7% (BFPs, CW pumps, CT fans, misc.) |

GT capability falls by about 0.42% per °F of ambient. The EPA gives
0.5–1% per °C for output and 0.15–0.4% per °C for heat rate [8].

## 2. The natural hierarchy

The industry's own breakdown is KKS (or a similar owner system): plant →
unit/block → system → equipment → component. Examples: MBA is the GT
compressor/turbine, MBP its gas fuel system, MBV its lube oil; HAD is the
HRSG evaporator/drum, HAH the superheater, HAJ the reheater; MAG is the
condenser; PAC the CW pumps; BAT the generator step-up transformer [9][10].
Halcyon Point uses the same levels in plain words:

| Level (`assetLevel`) | What it is | Halcyon Point |
|---|---|---|
| `site` | the plant | Halcyon Point (1) |
| `area` | power block and common plant | Block 1, Common Plant |
| `unit` | what an operator starts, stops and dispatches: **the unit of operation** | CTG-1, CTG-2, HRSG-1, HRSG-2, STG-1, Circulating Water, Fuel Gas Yard, Switchyard |
| `system` | KKS-style systems | compressor, combustion, HP section, feedwater, condenser, cooling tower, GSU… |
| `equipment` | named equipment | bearings, drums, BFPs, lube oil pumps, cooling tower cells, CEMS… |
| `component` | parts of equipment operators name individually | BFP motor and bearings, HP drum feedwater control valve, attemperator, CT fan gearbox |

**Where branches really differ** (spec §3.1):

- **CTG (17 assets):** seven systems. Some are leaves at the system level
  (inlet filter house, compressor, GSU). Others have equipment below them
  (combustion → gas control valve; turbine section → bearings #1/#2; lube
  oil → pumps A/B + cooler; generator → hydrogen system + exciter).
- **HRSG (23 assets):** HP / IP-reheat / LP pressure sections, a
  feedwater system and an SCR/emissions system. It is the deepest branch:
  HP drum → feedwater control valve, HP superheater → attemperator, BFP →
  motor + bearings all reach level 6.
- **STG (20 assets):** HP/IP and LP turbines with four bearings, a steam
  bypass (a system-level leaf), a condenser with vacuum and condensate
  pumps, lube oil, and an **air-cooled (TEWAC) generator**, which is a
  different type from the CTGs' **hydrogen-cooled generators** and has no
  hydrogen system under it.
- **Common plant:** very different shapes side by side:
  - Circulating Water is wide and deep: 8 cooling tower cells, each with a
    fan gearbox, plus a pump station with 3 CW pumps.
  - Fuel Gas Yard is flat: three system-level leaves.
  - Switchyard is a bus plus two line terminals.
- **Redundant equipment in standby:** each set has pumps that run and
  pumps that wait. BFP-B, lube oil pump B, vacuum pump B, condensate pump B
  and CW pump C are standby, reading zero flow and current. That is normal
  for 2 × 100% trains [4].

**Counts:** 129 assets, 57 asset types, 8 units. Several types
(`journal_bearing`, `lube_oil_system` and its pump and cooler types,
`static_exciter`, `gsu_transformer`) are shared between the CTG and STG branches because the
equipment really is the same kind. The two generators are separate types
because they are cooled differently.

## 3. The unit of operation

`unitLevel: "unit"`. Control-room operators on a combined-cycle plant
start, load, run back and trip the CTGs and the STG. They treat each HRSG
as its own thing to run (drum levels, attemperation, SCR, chemistry).
Common systems (circulating water, fuel gas, switchyard) have their own
operator displays and alarms, so each gets a tile too. That makes 8 tiles,
well inside the ≤ 24 budget.

## 4. KPIs and properties

| Type | Properties (unit) | Operator watches most |
|---|---|---|
| Plant | net output, dispatch target, gross output (MW), net heat rate (Btu/kWh HHV), equivalent availability (%), aux load (MW), ambient (°F) | net output vs target, heat rate |
| CTG | generator output (MW), EAF (%), fuel heat input (MMBtu/h), GT heat rate, corrected output (%), rating (static) | MW, corrected output |
| Compressor | isentropic efficiency (%), CPD (psig), CDT (°F), IGV (°) | efficiency |
| Combustion | dynamics hot tone (psi), GT-exit NOx (ppm) | dynamics |
| Turbine section | exhaust temperature, exhaust spread, wheelspace (°F) | exhaust temp, spread |
| Journal bearings | metal temperature (°F), shaft vibration (mils pk-pk) | metal temp |
| HRSG | HP and total steam flow (klb/h), stack temperature (°F) | HP flow |
| Drums | level from NWL (in), drum pressure (psig) | level |
| Attemperator | spray flow, valve position, superheat margin downstream | spray flow |
| BFP / motor / bearings | discharge pressure, flow, speed; motor current, winding temp; bearing temp, vibration (in/s) | discharge pressure, bearing temp, vibration |
| SCR / CEMS | NOx removal, NH₃ slip, stack NOx/CO/O₂, hours since daily cal | stack NOx, slip |
| STG | output, EAF, throttle pressure and temperature | MW |
| Condenser | backpressure (inHgA), hotwell level, TTD, air in-leakage, cleanliness | backpressure |
| Cooling tower | approach, wet bulb, basin level, total fan power; per cell: fan power, outlet temp; gearbox vibration, oil temp | approach |
| Fuel gas | supply pressure, flow; filter/separator DP; fuel temperature, Modified Wobbe Index; HHV, Wobbe, HC dew point | fuel temp, MWI |
| Switchyard | net export, bus voltage, frequency, line flows | export |

**Where the normal ranges come from:**

- **Exhaust spread:** normal 20–60 °F. A spread that moves around the
  annulus is combustion; one that stays at a single thermocouple is
  instrumentation [11].
- **Combustion dynamics:** DLN hot-tone dynamics sit around 1 psi and are
  high at 2–3 psi [12][13].
- **Inlet filter DP:** alarm at about 5 inH₂O [14].
- **Hydrogen purity:** normally 97–99% [15].
- **Attemperators:** must keep ≥ 30–50 °F of superheat downstream [16].
- **SCR:** inlet about 9–25 ppm, outlet about 2.5 ppm, slip limit about
  5 ppm [2][3].
- **Condenser backpressure:** 1.5–3 inHgA. Heat rate gets measurably
  worse as backpressure rises [17].
- **Cooling tower approach:** typically 5–10 °F [18].
- **BFP vibration:** alert at about 0.18 in/s RMS (ISO 20816) [19].
- **Fuel gas:** superheat about 50 °F above the hydrocarbon dew point, and
  heating value / Wobbe variation within about ±5% [20][21].
- **Transformer DGA:** Condition 1 limits H₂ ≤ 100 ppm and TDCG ≤ 720 ppm
  [22].
- **Water chemistry:** feedwater cation conductivity ≤ 0.2–0.3 µS/cm [23].

**Headline KPIs and how they roll up** (declared in `properties.json`):

- **Gross output** (plant, block) = **sum** of CTG and STG generator output.
- **Net output** = gross − auxiliary load (formula). Switchyard net export
  = **sum** of the two line flows, and equals net output.
- **Net heat rate** = block fuel heat input × 1,000 / net MW (formula,
  HHV). Block fuel input = **sum** of the CTGs' fuel heat input.
- **Equivalent availability (EAF, 24 h rolling)**, per NERC GADS [24]:
  (1 − equivalent derated hours / period hours) × 100. A derate is a
  capability limit, such as a runback. The plant and block values are the
  **mean** of the three generating units.
- **Corrected output** = capability corrected to ISO ambient, divided by
  new-and-clean capability. This is how performance engineers separate
  degradation from weather [25].
- **CW flow** = **sum** of CW pump flows. **Cooling tower fan power** =
  **sum** of cell fan power. **Approach** = CW supply − wet bulb.
- **NOx removal** = 1 − stack / inlet NOx.

## 5. Failure modes

| # | Asset | Cause | First symptom | Spreads to | Confirmed by | Usual fix | Timescale | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | GT compressor | Airborne fouling on blades | Efficiency and CPD down at the same IGV and ambient; corrected output down | Less exhaust energy → less HRSG steam; higher heat rate | Corrected performance vs sister unit | Online wash (partial), offline crank wash (full) | Days–weeks | [25][26] |
| 2 | Inlet filter house | Dust / humidity loading | Filter DP rising | Lower output; runback near 8 inH₂O | DP trend, inspection | Pulse clean, replace filters | Weeks–months | [14] |
| 3 | DLN combustor | Tuning margin loss (ambient, fuel variation, can imbalance) | Dynamics excursions in a tone band | NOx up; hardware damage; possible trip | High-speed dynamics spectrum | Retune fuel splits | Hours–weeks | [12][13][20] |
| 4 | Exhaust thermocouple | Open or failing junction | Spread high or erratic at one fixed position | Spurious high-spread trip | Spread doesn't move with load; other signals flat | Reject TC, replace at outage | Minutes | [11] |
| 5 | Fuel gas performance heater | Loss of heating water | Fuel temperature falls; MWI out of band | Both GTs run back; HRSG steam and ST output follow; NOx and dynamics up | Heater flow, fuel temperature | Restore heating water, reload | Minutes–hours | [20][21] |
| 6 | GT trip | Any protective trip | GT MW → 0 | HRSG pressure falls, ST runs back, bypasses open to the condenser | Trip log | Restart | Seconds–hours | [26][27] |
| 7 | HRSG tube | Creep, fatigue, corrosion, FAC | Makeup rising; feedwater/steam mismatch; acoustic alarm | Damage to neighbouring tubes | Walkdown, acoustic | Forced outage, repair | Days–weeks | [28][29] |
| 8 | HP drum level control | Swell/shrink plus control mode (single- vs three-element) | Level and FCV oscillating | High/low level trip → HRSG and GT trip | Control mode, trends | Restore three-element, retune | Minutes | [4][30] |
| 9 | Attemperator | Leaking or over-spraying nozzle/valve | Downstream temperature near saturation | Quench cracking of headers and tubes | Spray flow with the valve "closed" | Repair nozzle/valve | Weeks | [16] |
| 10 | Condenser / cooling | Air in-leakage, fouling, or **loss of tower cooling** | Backpressure up | ST output and heat rate worse | Air-removal flow, TTD, CW temperatures | Find leak / clean / restore fans | Hours–weeks | [17][18] |
| 11 | CT fan and gearbox | Gear wear, imbalance, motor trip | Vibration up or fan stopped | Approach up → CW temperature up → backpressure up | Local check, vibration | Reset or repair | Hours–weeks | [18] |
| 12 | BFP bearings | Wear, lubrication, cavitation | Bearing temperature and vibration up at the same flow | Pump trip → drum level upset | Vibration spectrum, oil sample | Swap to standby, repair | Weeks | [19][4] |
| 13 | SCR / ammonia | Over-injection, AIG maldistribution, catalyst ageing, reagent loss | Slip up (over-feed) or NOx up (no reagent) | Permit exceedance; ammonium bisulfate fouling downstream | CEMS, NH₃/NOx ratio | Restore setpoint or reagent; tune AIG | Minutes–months | [2][3] |
| 14 | CEMS | Calibration failure or missed daily cal | Data goes out of control 26 h after the last good cal | Substitute data, reportable hours | DAHS | Manual calibration | Hours | [31] |
| 15 | Steam bypass / drain valves | Seat erosion, passing valve | Downstream temperature up while the valve reads closed | Lost ST output, higher heat rate, more condenser heat load | Temperature check, thermography | Isolate, repair at outage | Weeks–months | [27][17] |
| 16 | GSU transformer | Insulation breakdown, partial discharge, overheating | DGA H₂ / TDCG rise | Forced outage | Lab DGA | Resample, plan outage | Days–months | [22] |
| 17 | Generator hydrogen | Seal oil air ingress, analyzer drift | Purity falling | Windage loss; trip near 80% | Analyzer check | Scavenge, fix seal oil | Hours–days | [15] |

**Assets with no relationship edges, and why:**

- **Exciters and hydrogen systems:** support equipment inside their
  generator, so containment already shows the connection.
- **Vacuum pumps:** remove air from the condenser; they have no process
  flow of their own.
- **Cooling tower cells and their gearboxes:** the tower is modelled as
  one heat-rejection node on the CW loop.
- **CEMS:** only its sample edge from the catalyst.
- **Gas chromatograph:** only a sample line.
- **Inlet filter house:** feeds the compressor only.

## 6. Normal-operation context

- **Operating mode:** the block runs on **AGC load-follow**. The dispatch
  target is 650 MW net in the morning and 705 MW from 10:25 for the
  afternoon peak. All units show `STEADY`: there is no startup, shutdown
  or trip today. Starts, runbacks and trips would use `RAMP_UP` /
  `RAMP_DOWN` / `STOPPED`.
- **Products:**
  - CTGs and STG: "Grid export (AGC)"
  - HRSGs: "HP / IP / LP steam"
  - Common plant: cooling water, fuel gas, 345 kV export
- **Routine work in the work list:**
  - shift turnover and dispatch review
  - HRSG and BOP rounds
  - water chemistry grab samples (cation conductivity, silica, pH, sodium
    [23])
  - planned lubrication of the spare CW pump
  - monthly GSU DGA review [22]
  - quarterly calibration of a steam flow transmitter
  - online compressor wash [26]
  - CEMS calibration under 40 CFR 75 [31]

## 7. Sources

1. Evolution of HRSGs for advanced combined cycle plants (Modern Power Systems) — https://www.modernpowersystems.com/hrsgs-boilers/evolution-of-hrsgs-for-advanced-combined-cycle-power-plants/
2. SCR performance management (CCJ Outage Handbook 2012) — https://www.ccj-online.com/2q-2012-outage-handbook/scr-performance-management/
3. GE 7HA.03 (Gas Turbine World) — https://gasturbineworld.com/ge-7ha-03-gas-turbine/
4. Fully automating HRSG feedwater pumps (POWER) — https://www.powermag.com/fully-automating-hrsg-feedwater-pumps/
5. GE 7HA gas turbine brochure (DirectIndustry) — https://pdf.directindustry.com/pdf/ge-gas-turbines/7ha-gas-turbine/34155-584137.html
6. GE 7HA fact sheet (filed with Kentucky PSC) — https://psc.ky.gov/pscecf/2022-00402/rick.lovekamp@lge-ku.com/03102023104355/11-KCA_DR1_LGE_KU_Attach_to_Q45_-_Att_1_GE_7HA_fact_sheet-product_specifications.pdf
7. EIA, Today in Energy: power plant heat rates — https://www.eia.gov/todayinenergy/detail.php?id=52158
8. EPA TSD, Efficient generation — combustion turbine EGUs (2024) — https://www.epa.gov/system/files/documents/2024-04/tsd-efficient-generation-combustion-turbine-egus-april-2024.pdf
9. KKS coding explained (TagSight) — https://tagsight.io/blog/kks-coding-explained
10. KKS handbook — https://pdfcoffee.com/kkshandbook-pdf-free.html
11. Exhaust temperature spread (MD&A) — https://www.mdaturbines.com/resources/exhaust-temperature-spread/
12. US 2005/0278108 — combustion dynamics / lean blowout detection — https://patents.google.com/patent/US20050278108
13. 9FA+e DLN tuning, peak dynamics (control.com forum) — https://control.com/forums/threads/9fa-e-dln-tuning-peak-1-dynamics.42091/
14. Gas turbine air filter system optimization (Power Engineering) — https://www.power-eng.com/gas/turbines/gas-turbine-air-filter-system-optimization/
15. Maintaining hydrogen purity in turbine generators (Process Sensing) — https://www.processsensing.com/en-us/blog/maintain-hydrogen-purity-turbine-power-generators.htm ; GT generator hydrogen purity drop (control.com) — https://control.com/forums/threads/gt-generator-hydrogen-purity-drop.28654/
16. Attemperators: HRSG enemy No. 1 (CCJ) — https://www.ccj-online.com/combined-cycle-journal-number-50/attemperators-hrsg-enemy-no-1/ ; Proper steam temperature control (CCJ) — https://www.ccj-online.com/combined-cycle-journal-number-50/heat-recovery-steam-generators-proper-steam-temperature-control-reduces-operational-risks/
17. Economic effects of condenser backpressure on heat rate (Conco) — https://conco.net/sites/default/files/userfiles/files/techical-papers/economic-effects-condenser-backpressure-heat-rate-condensate-subcooling-and-feedwater-dissolved-oxyg.pdf ; HRSG and condenser performance monitoring (Power Engineering) — https://www.power-eng.com/operations-maintenance/hrsg-condenser-performance-monitoring-part-2/
18. Closed-cycle cooling, engineering study (California OPC) — https://opc.ca.gov/webmaster/ftp/project_pages/OTC/engineering%20study/Chapter_4_Closed_Cycle_Cooling.pdf ; Lunch 'n' learn: cooling towers (CCJ) — https://www.ccj-online.com/2q-2011/lunch-n-learn-cooling-towers/
19. Boiler feed pump condition monitoring (iFactory) — https://ifactoryapp.com/article/boiler-feed-pump-condition-monitoring
20. GE GER-3620P, Heavy-duty gas turbine operating and maintenance considerations — https://www.gevernova.com/content/dam/gepower-new/global/en_US/downloads/gas-new-site/resources/reference/GER-3620-P.pdf
21. Guidelines for fuel gas supply to gas turbines (Cheresources) — https://www.cheresources.com/invision/blog/4/entry-366-guidelines-for-fuel-gas-supply-to-gas-turbines/ ; How natural gas fuel variability impacts GT operation (CCJ) — https://www.ccj-online.com/gas-turbines-how-natural-gas-fuel-variability-impacts-gt-operation/
22. IEEE dissolved gas analysis guidelines (Facility Results) — https://facilityresults.com/wp-content/uploads/2019/10/FR-IEEE-DISSOLVED-GAS-ANALYSIS-GUIDELINES.pdf
23. On-line HRSG water/steam chemistry monitoring (Power Engineering) — https://www.power-eng.com/operations-maintenance/the-importance-of-on-line-hrsg-and-cogeneration-water-steam-chemistry-monitoring/
24. NERC GADS Appendix F, performance indexes and equations — https://www.nerc.com/globalassets/programs/rapa/gads/conventional/appendix_f_equations_2025_dri.pdf
25. GER-3620P [20], §performance degradation (recoverable vs non-recoverable)
26. Online and offline washing (CCJ 2011 Outage Handbook) — https://www.ccj-online.com/special-issue-2011-outage-handbook/2011-outage-handbook-online-offline-washing/
27. Proper steam bypass system design (Power Engineering) — https://www.power-eng.com/gas/turbines/proper-steam-bypass-system-design-avoids-steam-turbine-overheating/
28. HRSG tube failure statistics (Tetra Engineering) — https://www.tetra-eng.com/whitepaper/hrsg-tube-failure-statistics
29. Acoustic monitoring for early detection of HRSG tube leaks (CCJ) — https://www.ccj-online.com/acoustic-monitoring-proves-worth-for-early-detection-of-hrsg-tube-leaks/
30. Drum level control (Instrumentation & Control, SA) — https://www.instrumentation.co.za/regular.aspx?pklregularid=5274
31. 40 CFR Part 75, Appendix B (daily calibration and data validity) — https://www.law.cornell.edu/cfr/text/40/appendix-B_to_part_75
