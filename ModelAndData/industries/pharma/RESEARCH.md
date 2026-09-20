# Biologics (mAb) drug substance — research brief (Solace Park)

Industry pack `pharma`, built to `INDUSTRY_PACK_SPEC.md` v2. Everything the
generator does is traceable to a section here, and every scenario in
`SCENARIOS.md` maps to a failure mode in §5. Numbers in brackets are sources
in §7; operating details that are standard industry practice but not tied to
one source are marked *(practice)*.

## Choices (Amy's answers to spec §0)

- **Industry:** a **biologics drug-substance (DS) plant** making one
  monoclonal antibody (mAb) in CHO cell fed-batch culture: seed train,
  three 12,000 L stainless production bioreactors, harvest, Protein A
  capture, low-pH viral inactivation, AEX/CEX polishing, virus filtration,
  UF/DF and bulk freeze, plus the clean utilities a GMP plant runs on (WFI,
  clean steam, CIP, cleanroom HVAC, media and buffer prep).
- **Names:** you picked "you choose". Site **Solace Park**; product
  **SLP-201** (fictional mAb); batches numbered **26-1xx**. Units use the
  short tags operators use on a batch board: SBR-1 (seed), PBR-1…3
  (production), HRV-1, CAP-1, VIN-1, POL-1, VF-1, UFDF-1, BDS-1, WFI-1,
  CSG-1, CIP-1, AHU-3, MP-1, BP-1.
- **What it shows off: an ISA-88 batch plant.** Wind is wide, ccgt is deep
  with many layers, pipeline is a serial chain. This pack uses the
  hierarchy the pharma industry's own batch standard defines
  (site → area → process cell → unit → equipment module → control module),
  and at "now" the units are in **different phases of different batches at
  once**: a day-13 culture, a day-7 culture, a vessel in CIP/SIP
  turnaround, a seed waiting to be transferred, a capture skid cycling on
  one batch while the polishing skid works on the previous one. Two units
  show the Now strip's `changeover` state, which no other generic pack
  uses.
- **Audience focus: GMP and batch release.** Scenarios are framed the way
  a biologics shift sees them: critical process parameters (CPPs) against
  their normal operating range (NOR) and proven acceptable range (PAR),
  validated hold times, deviations raised, SIP acceptance (F₀, cold point),
  environmental-monitoring (EM) consequences of an HVAC excursion, and a
  schedule/compliance window (seed transfer) at risk. The site's headline
  `open_deviations_count` steps up as the day's events raise deviations.
- **Timeline:** the spec default, **2026-08-28, 08:00–14:05 at 5-minute
  steps** (74 points). A biologics batch lasts weeks, so a 6-hour window
  shows each batch as a slice (day 13 of PBR-1, day 7 of PBR-2…), which is
  exactly how a shift experiences it. 5-minute averages are what a DCS
  trend shows an operator; SIP acceptance itself uses 1–5 s data [4], so
  the F₀ quoted in SCENARIOS.md is approximate.
- **Units:** SI/metric, as biopharma DCS and batch records use them (L,
  °C, bar(g), mmHg for pCO₂, g/L, mS/cm, µS/cm, Pa, LMH).

## 1. Process overview

A vial of the master/working cell bank is expanded through shake flasks
and small bioreactors (the **seed train**) to an **N-1** seed bioreactor,
which inoculates the **production bioreactor** (N) at 0.3–0.5 ×10⁶
cells/mL [1]. The production culture runs 12–21 days in **fed-batch**:
concentrated feed medium is added, pH is held near 7.0 with CO₂ sparging
(acid side) and base addition (alkaline side) [2], dissolved oxygen (DO)
is held near 40% air saturation by an air → O₂ cascade, and temperature is
often shifted from 36.5–37 °C to ~33 °C late in the run to extend
production *(practice)*. Cells secrete the antibody into the broth.

At harvest the broth is clarified (disk-stack centrifuge, then depth
filters [9]) into a hold tank. **Downstream**, Protein A affinity
chromatography captures the antibody in repeated cycles (equilibrate,
load, wash, elute at ~pH 3.6, strip/CIP) [6]; the acidic eluate is held at
pH 3.3–3.7 for ≥ 60 min to inactivate enveloped viruses [10]; anion- and
cation-exchange steps polish out host-cell protein, DNA and aggregates; a
virus filter removes small viruses (> 6 LRV parvovirus) [10]; UF/DF
concentrates the protein and exchanges it into formulation buffer [7]; the
bulk is 0.2 µm filtered into bottles and frozen as **drug substance**.

Everything product-contact runs on **clean utilities**: Water for
Injection (WFI) from a still into a hot recirculating loop (≥ 70 °C,
typically 80–95 °C; conductivity ≤ 1.3 µS/cm, TOC ≤ 500 ppb, endotoxin
< 0.25 EU/mL) [3]; **clean steam** for sterilize-in-place (SIP) [4][11];
**CIP** skids that wash vessels and lines between batches [4]; and
cleanroom **HVAC** that keeps a pressure cascade between room grades
(10–15 Pa between grades is the usual guidance value) [12][13]. Before
viral inactivation and after it, product is handled in **segregated
suites** ("pre-viral" and "post-viral"), each with its own air handling
*(practice)*.

Every batch has an electronic batch record. Each unexplained discrepancy
must be investigated before QA can release the batch [14]; CPPs have a
registered PAR, and running outside the NOR but inside the PAR is allowed
but reportable within the site's quality system [15].

## 2. The natural hierarchy (ISA-88 physical model)

ISA-88 is the batch-control standard used across pharma and biotech. Its
physical model breaks a plant into enterprise → site → area → process
cell → unit → equipment module → control module [5][16]. The enterprise
level is dropped here (one site), giving **6 levels**:

| Level | ISA-88 meaning | Solace Park | Count |
|---|---|---|---|
| site | one plant | Solace Park | 1 |
| area | a major part of the site | Upstream, Downstream, Utilities & Support | 3 |
| process cell | the equipment a batch uses for a group of steps | Seed Train, Production Bioreactors, Recovery, Purification, Bulk Drug Substance, Clean Utilities, Solution Prep | 7 |
| unit | equipment that runs one unit procedure on one batch at a time | SBR-1, PBR-1…3, HRV-1, CAP-1, VIN-1, POL-1, VF-1, UFDF-1, BDS-1, WFI-1, CSG-1, CIP-1, AHU-3, MP-1, BP-1 | 17 |
| equipment module | a group of devices doing one minor processing activity | agitation, gas control, pH control, temperature, feed, exhaust; guard filter, column, detectors; still, tank, loop; fans, HEPA, rooms… | 46 |
| control module | a sensor/actuator with its own control | DO probes A/B, pCO₂ probe, base pump, feed pump; room DP sensors | 22 |

Total **96 assets**. Real branch differences:

- **Seed vs production bioreactors are two types.** Both share the
  agitation, gas-control, pH and temperature modules (same module types,
  same children), but the production vessel also has **feed addition** and
  an **exhaust** module. That is a real difference in the asset, so it's
  two types (spec §3.1).
- **Leaves at three levels.** Utility units such as CSG-1, CIP-1, MP-1 and
  BP-1 are leaves at the unit level; chromatography skids stop at
  equipment modules; bioreactors and AHU-3 go down to control modules.
- **`process_cell` is one type** with mixed children (a cell holding
  bioreactors, one holding skids, one holding utilities). ISA-88 treats a
  process cell as a container, so this is the "container holding a mix"
  case; the validator warning is expected.
- **Duplicated measurement.** Each bioreactor has two DO probes: A
  controls, B monitors *(practice)*. That redundancy is what makes the
  instrument-vs-process scenario (06) diagnosable.

## 3. The unit of operation

The ISA-88 **unit** (`unitLevel: "unit"`). A unit runs one unit
procedure of one batch at a time; batch records, recipes, status boards
and CIP/SIP schedules are all written against units. 17 tiles fit the
Now strip (≤ 24).

## 4. KPIs and properties

Normal values below are what the generator uses. Keys follow spec §3.3;
full metadata is in `properties.json`. **P1** = what the operator watches
most.

| Type | Properties (P1 in bold) | Normal | Sources |
|---|---|---|---|
| production_bioreactor | **VCD**, **viability**, **titer**, product mass, working volume, culture day, osmolality | VCD 16–22 ×10⁶/mL, viability > 80%, titer 2–6 g/L, 10–11.5 kL, 350–410 mOsm/kg | [1][2][8] |
| seed_bioreactor | **VCD**, **viability**, culture day, volume, transfer limit (static) | 4–6 ×10⁶/mL, > 93% viability, passage criteria | [1] |
| agitation_module | speed, power, **gearbox vibration**, seal temperature | 48–85 rpm, 1–2 mm/s | *(practice)* |
| gas_control_module | O₂, air, CO₂ sparge, overlay | O₂ ∝ VCD; overlay 0.05–0.2 VVM (≈ 120 slpm here) | [8] |
| do_probe | **DO %**, probe signal quality | 40% air sat. | [17] |
| pco2_probe | **pCO₂** | 30–100 mmHg healthy; 140–200 at scale without mitigation | [8][18] |
| ph_control_module / base_pump | **pH**, base added; base pump rate, base tank level | pH 7.0 ± 0.05–0.10 dead band | [2] |
| temperature_control_module | **vessel temp**, jacket, drain (cold point) | 36.5 °C (33 °C shifted); SIP ≥ 121.1 °C | [4] |
| feed_module / feed_pump | **glucose**, feed added; **pump rate**, interruptions | 3–5 g/L | *(practice)* |
| exhaust_module | filter DP, vessel pressure, off-gas CO₂ | 0.15 bar(g); 5–8% CO₂ | [8][18] |
| capture_skid | **flow**, cycle, **step yield**, load processed | 38 L/min load, 93–96% yield | [6] |
| chrom_column | **column DP**, **breakthrough**, resin cycles | 1.3 bar; < 1.5%; lifetime 100–300 cycles | [6][19] |
| detector_block | UV280, conductivity, effluent pH | elution pH ≈ 3.6 | [6][10] |
| viral_inactivation_unit | **pool volume**, **pool pH** | pH 3.3–3.7, ≥ 60 min | [10] |
| virus_filtration_unit / virus_filter | **flux**, throughput; **feed pressure** | ≈ 2.1 bar (30 psi) | [20] |
| ufdf_skid / tff_module | TMP, **permeate flux**, retentate conc.; NWP | 0.5–1.5 bar, 25–60 LMH | [7] |
| bds_freezer | **freezer temp**, compressor duty | −45 °C | *(practice)* |
| multi_effect_still | **distillate output**, plant steam | 3,050 L/h, ≈ 0.26 kg steam/L | *(practice)* |
| wfi_loop | **return temp**, **conductivity**, TOC, velocity | ≥ 80 °C, 0.5 µS/cm, < 100 ppb, 1–1.5 m/s | [3] |
| clean_steam_generator | **header pressure**, flow, level | 3 bar(g) | [11] |
| cip_skid | step, supply temp, flow, **return conductivity** | 0.5–1% NaOH at 50–80 °C; rinse to ≤ 1.3 µS/cm | [4] |
| air_handling_unit / ahu_fan / hepa_bank | **airflow**, supply temp; **fan speed**, current; HEPA DP | — | [12] |
| room_dp_sensor | **room DP** | 10–15 Pa between grades | [12][13] |
| media / buffer prep | **tank level**, osmolality or conductivity, temp or pH | medium ≈ 300 mOsm/kg | *(practice)* |

**Headline KPIs and rollups** (derivations in `properties.json`):

- Site: production culture volume (Σ bioreactor working volume),
  **open deviations**, batches in process.
- Upstream: product in bioreactors (Σ titer × volume), total O₂ demand
  (Σ O₂ sparge), units in service.
- Downstream: purification load flow (Σ skid flows), units in service.
- Utilities: WFI draw, **lowest room DP in the post-viral suite** (min of
  the room sensors), units in service.
- Process cell: units in service (a **count**: child units processing
  product or supplying a utility at that step; standby, CIP/SIP
  turnaround and trips excluded; precomputed per spec §3.5) and units in
  the cell (static).
- Formulas, not simple aggregates: product mass (titer × volume), load
  processed, base and feed added (integrals of the pump rates), WFI
  available (level × tank volume), feed interruptions in the last hour.

Biologics plants don't lead with OEE. The headline numbers a DS shift
watches are right-first-time batches (no deviations), CPPs within NOR,
titer and step yields, and schedule adherence of the batch plan *(practice)*.

## 5. Failure and abnormal modes

| # | Mode | Asset | Physical cause | First symptom | Spreads to | Confirmed by | Usual fix | Timescale | Src |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **pCO₂ accumulation** | production bioreactor | CO₂ produced faster than stripped: low surface-to-volume at scale, 2 m hydrostatic head, low overlay/sparge | pCO₂ rising; pH at low dead-band edge | base addition ↑ → osmolality ↑; glycosylation and titer drop above ~150 mmHg | offline blood-gas pCO₂ | restore/raise overlay or air sparge; replace CO₂ in pH control | hours | [8][18] |
| 2 | **DO probe fault** | DO probe | fouling, membrane or cable/connector fault | one probe erratic; its diagnostic drops | none if it's the monitor probe; DO cascade upset if it's the control probe | compare with the redundant probe and O₂ flow | reseat, recalibrate or swap at next turnaround | minutes | [17][21] |
| 3 | pH probe drift | pH loop | protein fouling, reference depletion (0.01–0.03 pH/day) | offline vs online pH gap | wrong base/CO₂ use | daily offline check; offset if > 0.05 | one-point standardization | days | [2] |
| 4 | Osmolality creep | production bioreactor | cumulative base (≈ 2 mOsm/kg per mL 1 M NaOH per L) and feed | osmolality ↑ | growth inhibition > 400 mOsm/kg | offline osmometer | reduce base demand (fix pCO₂), adjust feed | days | [2][18] |
| 5 | Foaming | exhaust module | surface-active proteins from stressed/lysing cells | foam level, exhaust filter DP spike | vessel over-pressure, sterility loss, probe fouling | sight glass, filter DP | antifoam 10–30 ppm, reduce sparge | minutes | [21] |
| 6 | **Agitator drive / mechanical seal wear** | agitation module | gearbox bearing wear or lube loss; heat reaching the bottom-entry seal | vibration ↑ at constant rpm | seal temp ↑; seal failure = sterility breach | portable spectrum, seal barrier pressure | nurse to harvest; repair at turnaround | days | *(practice)* |
| 7 | **Feed pump micro-stops** | feed pump | worn peristaltic tubing slipping | repeated short flow-alarm stops | feed behind recipe → glucose dips | pump inspection | aseptic tubing change, catch-up rate | hours | *(practice)* |
| 8 | **SIP cold spot** | bioreactor (drain leg) | air pockets, condensate pooling, failed trap, or low steam supply pressure | cold point < 121.1 °C at hold start | failed SIP → repeat → schedule slip | thermocouple map, F₀ ≥ 15 min at coldest point | purge longer, fix trap or supply, repeat SIP | tens of minutes | [4][11] |
| 9 | **Clean steam supply loss** | clean steam generator | feed pump cavitation, level control hunting, demand > capacity | generator level hunting, header pressure sag | every SIP on the header | trend + field check | clean strainer, stagger SIPs | minutes–hours | [4][11] |
| 10 | CIP failure | CIP skid | low caustic temperature/time, blocked spray device | high final-rinse conductivity or TOC | vessel not released for SIP | rinse sample, riboflavin coverage | re-clean | hours | [4] |
| 11 | **Protein A capacity loss** | Protein A column | ligand hydrolysis and fouling with cycles (DBC down 10–25% over 200 cycles) | breakthrough ↑ at fixed load; step yield ↓ | product lost in flow-through; later repack | DBC test (alert 85%, action 75% of initial) | reduce load challenge, repack/replace resin | cycles (days) | [6][19] |
| 12 | **Guard / depth filter plugging** | guard filter, depth filters | fines and debris in clarified harvest (low viability, high solids) | DP climbing fast in one load | skid DP interlock stops the pump; load hold clock starts | DP trend, harvest turbidity | replace filter, resume within the validated hold | minutes | [9] |
| 13 | UF/DF fouling | TFF module | protein/antifoam fouling | flux decay > 70% in the first hour | long process time, yield loss | NWP after CIP | clean or replace cassettes | hours | [7][21] |
| 14 | Virus filter pressure interruption | virus filter | feed switching or pump stop | pressure drop to zero mid-run | small-virus retention may be compromised | validation data on interruptions | avoid, or justify within validated conditions | minutes | [20] |
| 15 | WFI loop excursion | WFI loop | heater/HX failure, RO/EDI exhaustion upstream, biofilm | return temp < 70 °C, conductivity or TOC ↑ | every point of use; product made with affected water is quarantined | POU samples, TOC | sanitize, investigate, CAPA | hours–days | [3] |
| 16 | **WFI still performance loss** | multi-effect still | non-condensable gases not vented (vent valve closed), scaling | output ↓ while plant steam ↑ | WFI tank draws down under peak demand | vent valve and column pressure check | open/clean vent, descale | hours | *(practice)* |
| 17 | **Cleanroom pressure-cascade loss** | AHU / rooms | supply fan or drive trip, HEPA loading, doors held open | room DP ↓, airlock reverses | open processing stopped; EM results needed before disposition | DP trend, EM plates | start standby fan, EM sampling, deviation | minutes (+ 48–72 h EM) | [12][13] |
| 18 | Adventitious virus contamination | production bioreactor | contaminated raw material (vesivirus 2117 at Genzyme Allston, 2009) | falling cell productivity | plant shutdown, sanitization | PCR / virus assays | decontaminate, raw-material controls | days–months | [22] |
| 19 | **Early viability decline** | production bioreactor | late-culture death, shear, nutrient/metabolite stress | viability falling faster than forecast while titer still rises | HCP/DNA/protease load at harvest; harder clarification | offline viability | bring harvest forward (criteria e.g. ≥ 70%) | hours | [1] *(practice)* |
| 20 | **Seed overgrowth / missed transfer window** | seed bioreactor | destination not ready (turnaround slip) | VCD approaching the passage limit | lost production slot if criteria are exceeded | seed VCD, passage criteria (viability > 90%) | seed-hold contingency (e.g. lower temperature), re-sequence | hours | [1] |

Bold rows are used by a scenario.

## 6. Normal-operation context

- **Operating modes** (Now strip): `STEADY` for units processing a batch
  or supplying a utility; `CHANGEOVER` for CIP/SIP turnaround (PBR-3,
  UFDF-1); `STANDBY` (neutral colour) for units clean and waiting
  (HRV-1, VF-1).
- **Products:** one product, SLP-201. The Now-strip `product` field carries
  the batch and phase instead ("SLP-201 · batch 26-114 (day 13)",
  "Turnaround → batch 26-117"), which is what a batch board shows.
- **Routine work:** shift handover and tier-1 huddle, daily bioreactor
  samples (VCD/viability, metabolites, offline pH/pCO₂), WFI point-of-use
  sampling, routine EM during operations, electronic batch record review
  by exception, medium sampling and QA release, pre-use filter flushes,
  post-CIP NWP tests.

**Assets with no relationship edges:** the room DP sensors (they measure
the rooms, nothing flows through them). Containment already links them
to the room-monitoring module.

**Relationship layers (10):** `process_flow`, `media`, `buffer`, `wfi`,
`clean_steam`, `cip`, `hvac`, `off_gas`, `control`, `chemical_dosing`, 79
edges. Real cycles: WFI tank → loop → tank; UF/DF tank → cassettes →
tank. CIP circuits are loops too, but they're drawn as one supply/return
edge each (see SCENARIOS.md, "Known app behaviour").

## 7. Sources

1. BioProcess Tools, "How to develop a seed train for mammalian cell culture" — https://bioprocesstools.com/blog/seed-train-development/
2. BioProcess Tools, "Bioreactor pH control: CO₂ sparging, base addition & tuning" — https://bioprocesstools.com/blog/bioreactor-ph-control/
3. BioProcess Tools, "WFI and purified water systems for bioprocessing" — https://bioprocesstools.com/blog/wfi-purified-water-systems/
4. BioProcess Tools, "SIP and CIP validation for bioreactors" — https://bioprocesstools.com/blog/cip-sip-validation/
5. ISA-88 (Wikipedia) — https://en.wikipedia.org/wiki/ISA-88
6. BioProcess Tools, "Dynamic binding capacity optimization for Protein A chromatography" — https://bioprocesstools.com/blog/protein-a-dbc-optimization/
7. BioProcess Tools, "TFF flux calculation: UF/DF membrane sizing & diafiltration" — https://bioprocesstools.com/blog/tff-membrane-sizing-diafiltration/
8. BioProcess Tools, "Dissolved CO₂ (pCO₂) control in mammalian cell culture" — https://bioprocesstools.com/blog/dissolved-co2-pco2-cell-culture/
9. BioPharm International, "Harvest and recovery of monoclonal antibodies from large-scale mammalian cell culture" — https://www.biopharminternational.com/view/harvest-and-recovery-monoclonal-antibodies-large-scale-mammalian-cell-culture
10. BioPharm International, "Antibody purification process development and manufacturing" — https://www.biopharminternational.com/view/antibody-purification-process-development-and-manufacturing
11. ISPE Pharmaceutical Engineering, "Introduction to steam quality and testing" — https://ispe.org/pharmaceutical-engineering/july-august-2022/introduction-steam-quality-and-testing
12. Genesis AEC, "Why differential pressure is critical in GMP cleanrooms" — https://www.genesisaec.com/news-events/blog/pharmaceutical-cleanroom-differential-pressure/
13. GMP Journal, "Regulation and control of room pressure in sterile pharmaceutical manufacture" — https://www.gmp-journal.com/current-articles/details/regulation-and-control-of-room-pressure-in-the-sterile-pharmaceutical-manufacture-requirements-and-technical-implementation.html
14. 21 CFR 211.192, Production record review — https://www.law.cornell.edu/cfr/text/21/211.192
15. EMA, Q&A on NOR, PAR, design space and normal variability of process parameters — https://www.ema.europa.eu/en/documents/scientific-guideline/questions-and-answers-improving-understanding-normal-operating-range-nor-proven-acceptable-range-par-design-space-dsp-and-normal-variability-process-parameters_en.pdf
16. ICONICS, ISA-95 and ISA-88 hierarchical structures — https://documentation.iconics.com/v11/Content/Assets/ISA95-and-ISA88-hierarchical-structures.htm
17. Eppendorf, "Dissolved oxygen control in bioreactors" — https://www.eppendorf.com/us-en/lab-academy/applied-industries/bioprocessing/introduction-to-bioprocessing/bioprocess-monitoring-and-control/do-control-in-bioreactors/
18. BioProcess International, "Lessons in bioreactor scale-up, part 6: dissolved carbon dioxide" — https://www.bioprocessintl.com/bioreactors/lessons-in-bioreactor-scale-up-part-6-dissolved-carbon-dioxide-and-its-impact-on-cell-culture-systems
19. "A mechanistic study of Protein A chromatography resin lifetime", J. Chromatogr. A — https://www.sciencedirect.com/science/article/abs/pii/S0021967309008863
20. Cytiva, "Virus filtration: robust retention after pressure interruptions" — https://www.cytivalifesciences.com/en/us/insights/virus-filtration-robust-retention-after-pressure-interruptions
21. BioProcess Tools, "Bioreactor foaming troubleshooting" — https://bioprocesstools.com/blog/bioreactor-foaming-troubleshooting/
22. BioPharm International, "Genzyme detects virus contamination of bioreactor, halts production" (2009) — https://www.biopharminternational.com/view/genzyme-detects-virus-contamination-bioreactor-halts-production
