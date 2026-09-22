# Drinking-water treatment — research brief (Meridian)

Industry pack `water`. **This pack predates `INDUSTRY_PACK_SPEC.md`.** It was
hand-built as one of the three original demo packs, converted once to the
generic format by `ModelAndData/tools/convert_legacy_to_generic.py` (spec
§12), and only then given a generator. `generate.py` was written to
**reproduce** the converted pack: the hierarchy, relationships, property keys
and metadata, and attention- and work-item text are kept exactly (saved user
settings are keyed by them); the telemetry is regenerated from the physics
below. This brief is therefore shorter than the other packs' and describes
the process the existing model stands for, not choices made from scratch.
Numbers in brackets are sources in §7; *(practice)* marks common operator
knowledge not tied to one source.

## 1. Process overview

Meridian is a conventional surface-water plant making potable water from a
river/reservoir source. Each train runs the classic multi-barrier sequence
[1][5]:

1. **Intake**: bar/travelling screens remove debris; raw water pumps lift
   the flow into the plant. Raw turbidity, pH and algae are the incoming
   "load" the rest of the plant must handle.
2. **Coagulation**: a metal-salt coagulant (alum or ferric) is dosed by a
   diaphragm metering pump into a rapid-mix basin (G ≈ 600–1000 s⁻¹). The
   dose is set from **jar tests** and paced to flow; it must move with raw
   water quality.
3. **Flocculation**: slow paddle mixing (G ≈ 20–70 s⁻¹, 20–40 min) grows
   the destabilised particles into settleable floc.
4. **Sedimentation**: floc settles into a sludge blanket that collectors
   (chain-and-flight or travelling bridge) sweep to a hopper for periodic
   desludging. Settled-water turbidity is the key intermediate KPI
   (Partnership for Safe Water goal < 2 NTU when raw > 10 NTU) [3].
5. **Filtration**: rapid gravity dual-media filters. **Headloss** grows as
   the bed captures solids; the filter is **backwashed** on headloss,
   effluent turbidity or run time (typically 24–72 h), which resets
   headloss and is followed by a short "ripening" turbidity spike [4][6].
   Filtered turbidity must be ≤ 0.3 NTU in 95% of samples and never > 1 NTU
   (US SWTR / IESWTR) [1]; well-run plants hold < 0.1 NTU [3].
6. **Disinfection**: chlorine dosed ahead of a baffled contact basin.
   Credit is the **CT** product (residual C × contact time T₁₀), which must
   stay above the required CT for the day's temperature and pH [2]. T₁₀ is
   the hydraulic residence time times a **baffling factor**, so taking
   baffles or basin volume out of service cuts CT directly.

## 2. The natural hierarchy

Operators talk about **plant → train → process stage → equipment**. Meridian
has one plant, six identical trains (T01–T06), six stages per train and
2–3 pieces of equipment per stage: 127 assets, perfectly regular (the only
pack that is). Real plants often share intake and clearwell across trains;
the demo gives every train its own intake and disinfection so each unit is
self-contained (a simplification kept from the original pack).

Edges (66): per train, a `process_flow` chain screen → raw pump → rapid mix
→ floc basin → sed basin → filter bed → contact basin; `chemical_dosing`
edges from each storage tank to its pump to its injection point; and a
`backwash` edge from the backwash pump to the filter bed. The rapid-mix
motor, paddle mixer and sludge collector act on their own basin and have no
flow edge (containment links them).

## 3. The unit of operation

The **train**: operators start, stop, derate and backwash-schedule by train,
and each train carries the headline KPIs (throughput vs target, availability,
quality factor, OEE, health, instability).

## 4. KPIs and how the generator makes them

| Where | Keys | Normal (demo) | Generator rule |
|---|---|---|---|
| Train | `line_throughput` vs `line_target_rate` (MGD) | 4.1 of 4.2 | 4.2 × performance × a slowly drifting flow factor; a backwashing filter costs ~1.5% for one sample |
| Train | `line_oee` | ~96.7% | availability × (throughput ÷ target) × quality ÷ 100 (formula derivation) |
| Train | `line_quality_factor` | ~99.2% | falls with settled turbidity above its setpoint and filtered turbidity > setpoint + 0.02 NTU |
| Train | `system_health_index` | ~96.6% | falls with metering-pump instability, headloss > 3.5 ft, extra backwashes, blanket > 45% |
| Train | `instability_index` | 2.5–6 | rises with intake flow variability, jar-test deviation and extra backwashes |
| Plant | `plant_*` | — | sum / mean / max of the six trains at every point (derivations) |
| Intake | raw turbidity, pH, screen ΔP, flow variability, algae risk | 7–11 NTU, pH 7.3–7.5 | AR(1); a turbidity excess raises screen ΔP, rake torque, cleaning cycles, flow variability, lowers pH |
| Coagulation | dose, jar-test deviation, pump stability, floc formation | 16–19 mg/L | dose = setpoint × pump delivered fraction × manual factor; the jar-test optimum rises weakly with raw turbidity; under-dosing lowers floc formation and floc size |
| Sedimentation | settled turbidity, blanket level, weir rate | ~2 NTU, 33–37% | settled = setpoint × (raw ratio)^0.2 × (optimum/dose)², lagged; + 0.04 NTU per % of blanket above 45% |
| Filtration | effluent turbidity, headloss, run time, UFRV, backwash frequency | 0.08 NTU, 2.4–5 ft rising ~0.09 ft/h | headloss = start + slope × hours since backwash; frequency = 168 ÷ projected run time; UFRV ∝ run time |
| Disinfection | residual, CT actual / required, contact time, demand, DBP risk | 1.2 mg/L, CT ≈ 146 vs 120 | CT = residual × contact time × k (per-train constant); demand rises with raw turbidity; residual partly compensates |

`filter_run_time_hrs` is the **projected run length** (what the current
headloss rate implies), not the hours since the last backwash. The
unit-filter-run-volume gauge was lowered from 7,000 to 4,000 gal/ft²
because UFRV is proportional to run length and the two shortened filters go
below the old floor. Everything else in `properties.json` is unchanged.

Baseline: every series is a per-(train, key) setpoint plus AR(1) drift
(φ 0.8–0.92). Setpoints come from a fixed RNG separate from the noise seed,
so rerunning with another `SEED` changes only the noise (spec §14.6).
Sibling spread is 0.1–4% for controlled process values and up to ~20% for
equipment of different duty (motor currents, pump flows), smaller than the
hand-built pack's 20–50%. Noise CVs are 0.02–1% for KPIs, 1–3% for
controlled values and 5–15% for loosely controlled ones.

## 5. Failure and abnormal modes

| # | Mode | Asset | Physical cause | First symptom | Spreads to | Confirmed by | Fix | Timescale | Src |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Metering-pump diaphragm wear / check-valve slip** | coagulant metering pump | worn diaphragm or fouled valves deliver less per stroke | discharge pressure ↓, stroke stability ↓, delivered dose ↓ at the same setting | settled turbidity ↑, floc size ↓, jar-test deviation ↑ | calibration column draw-down | recalibrate / rebuild | hours–days | *(practice)* [5] |
| 2 | **Sludge blanket rise** | sedimentation | solids loading up (raw turbidity) while desludge interval unchanged | blanket level ↑ | floc carryover, settled turbidity ↑, filter loading | blanket sampler/sensor | extra desludge, retime | hours | [5] |
| 3 | **Filter media fouling (mudballs, media loss)** | filter | incomplete backwash, air binding, mudball growth | headloss rises faster at the same rate; run length shortens | more backwashes, less net production | bed inspection / core | extended backwash, air scour, media replacement | days–weeks | [4][6] |
| 4 | **Turbidimeter fouling / sample-line fault** | online turbidimeter | bubbles, algae film, loose line | erratic reading unconfirmed by neighbours | none (that's the tell) | grab sample on a bench meter | clean, recalibrate | minutes | [1] |
| 5 | **Storm raw-water turbidity shock** | intake | runoff after rain | raw turbidity rises 5–10× within an hour | coagulant demand ↑, blanket ↑, settled/filtered turbidity risk, chlorine demand and DBP precursors ↑ | intake analysers, jar test | raise dose, slow the plant, extra desludging | hours | [3][5] |
| 6 | **Excess backwashing** | filter | media degradation, run-time setpoint too short, air binding | backwash count ↑, each cycle normal | backwash water use, net production ↓, ripening spikes | backwash log, headloss curves | media check, reset triggers | hours–days | [4][6] |
| 7 | **CT margin loss during maintenance** | contact basin | baffle work / volume out of service lowers T₁₀ | contact time ↓, CT ↓ at the same residual | compliance risk if CT < required | CT calculation | raise residual, limit flow, finish work | hours | [2] |
| 8 | Filter breakthrough | filter | floc penetration late in the run | effluent turbidity ↑ before headloss terminal | compliance | IFE turbidimeter | backwash early | hours | [1][3] |
| 9 | Coagulant underdose from pH shift | coagulation | alkalinity/pH change moves the optimum | settled turbidity ↑ at constant dose | filters | jar test | re-optimise | hours | [5] |
| 10 | Raw pump bearing wear | raw water pump | lubrication loss | vibration, bearing temperature ↑ | flow loss | vibration route | repair | days–weeks | *(practice)* |
| 11 | Screen blinding | intake screen | leaves, debris after storms | screen ΔP ↑, rake cycles ↑ | raw pump suction | visual | extra raking | hours | *(practice)* |
| 12 | Chlorine feed loss | chlorine feed pump | pump trip, empty day tank | residual ↓ | CT ↓ | residual analyser | restore feed | minutes | [2] |
| 13 | Algae bloom | intake | warm, nutrient-rich source | algae index, filter headloss ↑, taste/odour | shorter filter runs | microscopy | pre-oxidation, PAC | days | [5] |

Bold rows are used by a scenario.

## 6. Normal-operation context

All six trains run `STEADY` making **Potable Supply**. Routine work: shift
safety briefing, raw and finished water sampling, filter walkthrough,
backwash scheduling, jar tests, sludge blanket checks, instrument
verification against grab samples, end-of-shift handoff. One normal
end-of-run backwash (T05 at 12:30) happens during the shift.

## 7. Sources

1. US EPA, *Guidance Manual for Compliance with the Surface Water Treatment Rules: Turbidity Provisions* — https://www.epa.gov/sites/default/files/2020-06/documents/swtr_turbidity_gm_final_508.pdf
2. US EPA, *Disinfection Profiling and Benchmarking Technical Guidance Manual* (CT, T₁₀, baffling factors) — https://www.epa.gov/system/files/documents/2022-02/disprof_bench_3rules_final_508.pdf
3. AWWA, Partnership for Safe Water (settled and filtered turbidity goals) — https://www.awwa.org/programs/partnership-for-safe-water/
4. Washington State DOH, *Optimizing Backwash and Filter to Waste for Rapid Rate Filters* — https://doh.wa.gov/sites/default/files/2022-02/331-624.pdf
5. Health Canada, *Guidelines for Canadian Drinking Water Quality: Turbidity* (treatment processes and performance) — https://www.canada.ca/en/health-canada/services/publications/healthy-living/guidelines-canadian-drinking-water-quality-turbidity/page-7-guidelines-canadian-drinking-water-quality-turbidity.html
6. Oregon Health Authority, *What is filter backwashing?* — https://www.oregon.gov/oha/PH/HEALTHYENVIRONMENTS/DRINKINGWATER/OPERATIONS/TREATMENT/Documents/Backwash.pdf
