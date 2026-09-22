# Wastewater — research brief (Confluence)

Industry pack `wastewater`. **This pack predates `INDUSTRY_PACK_SPEC.md`.**
It was hand-built in the original four-level layout and converted once to
the generic format (spec §12). `generate.py` was written afterwards to
**reproduce** it: the hierarchy, relationship edges, property keys and
metadata, attention items and work items are kept exactly as converted
(saved layouts and asset sets are keyed by them), and every time series is
now generated from the process physics summarised here. This brief is
shorter than the newer packs' because the model design was already fixed;
it records the real-world basis for the numbers and the scenarios.
Numbers in brackets refer to the sources in §7.

## 1. Process overview

Confluence is a municipal activated-sludge plant: it takes raw sewage from
the collection system and discharges disinfected, dechlorinated effluent
(`product: "Reclaimed Effluent"`) under an NPDES permit. Six identical
parallel **treatment trains** (T01–T06) each carry about one sixth of the
flow (≈ 5.7 MGD each, ≈ 34 MGD plant; design 5.8 / 34.8 MGD) through the
conventional sequence [1, 2, 3]:

1. **Preliminary treatment.** A mechanically raked **bar screen** removes
   rags and debris (screenings, reported as ft³ per MG), a **grit chamber**
   settles sand and grit, and the **influent pump** lifts the flow to the
   primaries [4]. The screen's differential (head loss) rises as material
   builds up and each cleaning cycle knocks it back down; more screenings
   mean more cleaning cycles per hour.
2. **Primary clarification.** Quiescent settling removes about 50–70 % of
   suspended solids (TSS) and 25–40 % of BOD [1, 3]. A chain-and-flight or
   rake **sludge collector** drags settled sludge to the hopper, and a
   **scum skimmer** removes floatables. If the collector stops, the sludge
   blanket rises and solids start to pass over the weirs within minutes.
3. **Aeration (activated sludge).** Primary effluent mixes with return
   activated sludge in the **aeration basin**. **Blowers** push air through
   a fine-bubble **diffuser grid**; DO is held around 1.5–2.5 mg/L (≥ 2 for
   reliable nitrification) [3, 5]. Aeration is typically 50–60 % of a
   plant's energy. Key biology numbers: MLSS 1,500–4,000 mg/L,
   food-to-microorganism ratio (F:M) about 0.2–0.4 d⁻¹ for conventional
   plants, sludge age (SRT) about 5–15 days [3].
4. **Secondary clarification.** The mixed liquor settles; clarified
   effluent overflows, and the **RAS pump** returns thickened sludge to
   aeration at 25–75 % of influent flow (a manual setpoint or flow-paced)
   [3]. Settleability is tracked with the sludge volume index: SVI below
   about 100–120 mL/g settles well; above about 150 mL/g the sludge is
   bulking [6].
5. **Disinfection.** Sodium hypochlorite from the **chlorine feed pump**
   (flow-paced, trimmed on residual) gives a residual of about 0.5–1.0 mg/L
   over at least 15–30 minutes in the **chlorine contact basin**; the
   disinfection dose is expressed as **CT** = residual × contact time [7].
   A **dechlorination system** (sodium bisulfite) then removes the
   residual before discharge, dosed in proportion to the chlorine mass [8].

Secondary treatment must meet 30 mg/L BOD₅ and TSS (30-day average) and
85 % removal [9]; disinfection limits are set on fecal coliform or E. coli
in the permit. Results are reported monthly on the **Discharge Monitoring
Report (DMR)** [10].

## 2. The hierarchy (as built)

| Level | What it is | Confluence |
|---|---|---|
| `plant` | The treatment plant | Confluence (1) |
| `train` | One parallel treatment train — **the unit of operation** (`unitLevel`) | T01–T06 |
| `stage` | A process step within the train | Preliminary, Primary Clarifier, Aeration, Secondary Clarifier, Disinfection (5 per train) |
| `equipment` | Named equipment in the stage | 3 per stage (15 per train) |

127 assets, perfectly regular: every train has the same stages and
equipment. The shape is "many identical siblings" (six trains), which
gives the Now strip and fleet comparisons plenty to compare but no
structural variation — the newer packs cover uneven branches. Two
equipment types are reused in different stages (`sludge_collector` in the
primary and secondary clarifiers). The only train-crossing structure is
the plant rollup.

Relationship edges (12 per train, all `feeds_into`): the process-flow chain
screen → grit → influent pump → primary basin → aeration basin →
secondary basin → contact basin → dechlorination, the **return activated
sludge** loop (secondary basin → RAS pump → aeration basin), an
`air_flow` layer (blower → diffuser grid → aeration basin) and a
`chemical_dosing` edge (chlorine feed pump → contact basin). The scum
skimmer and both sludge collectors have no edges: they act on their own
basin, and the sludge line is outside the model.

## 3. KPIs and how the data is built

| Type | Watched most (P1) | Normal (as generated) | Driven by |
|---|---|---|---|
| Plant | throughput, OEE, health, instability | 34 MGD, 95.1 %, 95.2 %, ≈ 7 | sum / mean / max of the trains |
| Train | OEE, throughput, instability, health | 5.7 MGD, 95.1 %, 6.4, 95.2 % | formulas over the train's children |
| Preliminary | grit removal | 91 % | influent flow |
| Bar screen / grit chamber | differential pressure | 1.3 / 1.0 psi | flow, cleaning cycles |
| Influent pump / RAS pump | vibration | 2.4 mm/s | flow (current, discharge pressure follow it) |
| Primary clarifier | sludge blanket | 30 % | flow, collector running |
| Sludge collector / scum skimmer | motor current | 4.4 / 5.3 A | travel speed; cycle time ∝ 1/speed |
| Aeration | DO, MLSS | 2.0 mg/L, 2,800 mg/L | organic load, blower air |
| Blower | — (air flow P2) | 2,100 scfm | air demand ∝ load⁰·⁴; system curve for pressure |
| Diffuser grid | air distribution | 91 % | air flow (poor coverage below 95 % of design air) |
| Secondary clarifier | secondary TSS removal | 88 % | SVI, DO |
| Disinfection | chlorine residual, CT, fecal coliform risk, dechlor residual | 0.61 mg/L, 64, 10, 0.047 mg/L | CT = 2.84 × residual × contact time; risk ∝ (CT₀/CT)² |

Every signal is its per-asset setpoint (spread across the six trains) plus
slowly drifting AR(1) noise (lag-1 autocorrelation 0.8–0.93), with the
couplings above, so related values move together. A plant-wide diurnal
influent curve (−1.8 % at 08:00, +1.8 % at 10:45) gives the late-morning
**peak flow** that the WSIT10 story refers to.

**Train KPIs** (declared as `formula` derivations in `properties.json`):
availability, quality factor, a hidden performance factor and the health
index each start from a base value and lose a weighted penalty whenever a
watched signal in the train (DO, blower air, F:M, primary collector
current, primary TSS removal, SVI, fecal coliform risk) moves past a
tolerance from its setpoint; OEE = availability × performance × quality.
Total WIP is the volume in process (basin levels × nominal volumes),
instability is a weighted sum of influent-flow variability and primary
surge control, flow efficiency is effluent ÷ influent (the rest leaves as
wasted sludge). The plant rollups are exact sum/mean/max of the trains at
every point, as before.

## 4. Failure modes behind the scenarios

| # | Failure mode | Asset | Cause | First symptom | Spreads to | Confirm / fix | Timescale |
|---|---|---|---|---|---|---|---|
| 1 | Blower inlet filter fouling (WSIT08) | Blower → aeration | Dust/pollen loads the inlet filter; the blower can't deliver design air | DO falls while the DO controller is at full output; air flow below setpoint | Diffuser backpressure and coverage fall, discharge temperature rises (higher pressure ratio); nitrification and settling suffer | Inlet filter ΔP gauge, walk-down; clean or change the filter [5, 11] | hours |
| 2 | Filamentous bulking (WSIT09) | Secondary clarifier | Low DO, low F:M, septicity or nutrient deficiency favour filaments | SVI climbing over hours to days, blanket rising | TSS carryover, then disinfection demand | Microscopic exam; RAS increase, selector or chlorination of RAS [6] | days |
| 3 | Clarifier drive overload / shear-pin trip (WSIT10) | Primary sludge collector | Heavy sludge or debris under peak flow overloads the drive | Torque/current spike then zero; travel stops | Blanket rises, TSS and BOD removal fall, more load to aeration | Drive alarm and inspection; clear, reset and restart; check chain tension [1, 12] | minutes |
| 4 | RAS not matched to load (WSIT11) | Aeration / secondary | RAS on a fixed manual setpoint while organic load rises | F:M above target; air demand up | Poorer settling if sustained; effluent BOD | F:M and MLSS trend; adjust RAS, flow-pace it [3] | hours |
| 5 | Borderline disinfection before a DMR (WSIT12) | Disinfection | Higher flow shortens contact time; solids shield organisms | Coliform risk index rising toward the limit with residual and CT still nominal | Permit compliance | Grab sample, extra effluent coliform test, file the DMR on time [7, 10] | hours |

Other realistic modes the model can express but no scenario uses: bar
screen blinding (ΔP up, cycles up), grit carry-over (grit removal down,
pump vibration up), diffuser fouling (backpressure up at constant air),
DO probe drift (DO moves, air and ammonia don't), RAS pump bearing wear,
chlorine feed pump air lock (dose flow drops, residual falls), bisulfite
overfeed (dechlorinated residual at zero, residual offset negative).

## 5. Normal operation context

Plant mode `STEADY` on all trains, dry-weather flow. Routine work on a
day shift: process rounds, DO/MLSS/settleometer tests, SVI, clarifier
blanket checks, chlorine residual verification, screenings and grit
disposal, blower and pump checks, and the daily DMR data compilation [2].
The converted pack's work list contains only the five situation-driven
tasks (§ SCENARIOS).

## 6. Limits of the simplification

Flows are expressed as a factor on a nominal train flow rather than a
mass balance; the influent pump and RAS pump `flow_rate_gpm` are single
pumps of a larger station. CT uses a plant-specific scaling constant.
The fecal coliform "risk" is an index, not an MPN count. Instrument keys
and ranges come from the original hand-built pack and are kept for
compatibility.

## 7. Sources

1. US EPA, *Primer for Municipal Wastewater Treatment Systems*, EPA 832-R-04-001 (2004). https://www3.epa.gov/npdes/pubs/primer.pdf
2. California State University Sacramento, Office of Water Programs (K. Kerri), *Operation of Wastewater Treatment Plants*, Vols. 1–2.
3. Metcalf & Eddy / AECOM, *Wastewater Engineering: Treatment and Resource Recovery*, 5th ed., McGraw-Hill (2014) — primary removal, activated-sludge design ranges (MLSS, F:M, SRT, RAS).
4. US EPA, *Wastewater Technology Fact Sheet: Screening and Grit Removal*, EPA 832-F-03-011 (2003).
5. US EPA, *Wastewater Technology Fact Sheet: Fine Bubble Aeration*, EPA 832-F-99-065 (1999); US EPA, *Design Manual: Fine Pore Aeration Systems*, EPA/625/1-89/023 (1989).
6. D. Jenkins, M. Richard, G. Daigger, *Manual on the Causes and Control of Activated Sludge Bulking, Foaming, and Other Solids Separation Problems*, 3rd ed., IWA/CRC (2003).
7. US EPA, *Wastewater Technology Fact Sheet: Chlorine Disinfection*, EPA 832-F-99-062 (1999).
8. US EPA, *Wastewater Technology Fact Sheet: Dechlorination*, EPA 832-F-00-022 (2000).
9. 40 CFR Part 133, *Secondary Treatment Regulation*. https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-133
10. US EPA, NPDES Discharge Monitoring Reports and NetDMR. https://www.epa.gov/npdes/npdes-ereporting
11. Water Environment Federation, *Operation of Water Resource Recovery Facilities* (MOP 11), 7th ed. (2016) — aeration and blower O&M.
12. Water Environment Federation, *Clarifier Design* (MOP FD-8), 2nd ed. (2005) — collector drives and overload protection.
