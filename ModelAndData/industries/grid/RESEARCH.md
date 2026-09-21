# Electric transmission network — research brief (Vesper Grid)

Industry pack `grid`, built to `INDUSTRY_PACK_SPEC.md` v2. Everything the
generator does is traceable to a section here, and every scenario in
`SCENARIOS.md` maps to a failure mode in §5. Numbers in brackets are
sources in §7; operating details that are standard industry practice but
not tied to one fetched source are marked *(practice)*. Where the research
could **not** confirm a number, §6 says so rather than inventing one.

## Choices (Amy's answers to spec §0)

- **Industry:** an **electric transmission and sub-transmission network**
  operated from one control room: a looped **345 kV** backbone of four
  bulk substations, a **138 kV** sub-transmission network of five
  stations, and a **69 kV** supply network of four stations with a
  **normally-open tie**. Thirteen substations, no generation and no
  distribution feeders — the operator's world is elements, flows and
  contingencies.
- **Names:** you picked "you choose". The network is **Vesper Grid**.
  Districts: **Keldon** (345 kV bulk), **Harrow** (138 kV),
  **Sanbourne** (69 kV). Substations, north to south: Aldergate,
  Wyndham, Kessler, Thorne (345 kV); Bexhill, Orrin, Larkspur, Wexford,
  Colvin (138 kV); Pell, Navarre, Dunmore, Tilbury (69 kV). Two
  generation interconnections are named after the plants in the other
  packs — Aldergate's **Halcyon Point Tie** (the `ccgt` plant) and
  Thorne's **Boreas Ridge Tie** (the `wind` farm) — the same nod the
  `pipeline` pack makes to Halcyon Point.
- **What it shows off: a meshed network whose topology changes during
  the shift.** Every earlier generic pack has one directed flow path
  that never reconfigures: wind is a wide fleet, ccgt is deep with many
  layers, pipeline is a serial chain west to east, pharma is a batch
  plant. Here:
  - **The containment tree and the electrical network are different
    graphs.** `parentId` says which substation an asset stands in;
    the relationship edges say what is electrically connected to what,
    and they cross substations, cross districts and close into **real
    loops** (a 345 kV ring plus a diagonal, and two 138 kV loops).
  - **Redundancy is the point.** Two paths exist between most pairs of
    stations, so losing one element is survivable and the question an
    operator actually asks is *"can we survive losing the next one?"*
  - **The topology is switched mid-shift.** A **normally-open 69 kV tie**
    between Navarre and Dunmore is closed at 11:20 to transfer load, and
    the transfer visibly loads a *different* element instead of cleanly
    solving the problem (§5.12) — the honest behaviour [15].
  - **The same pair of assets carries two different layers.** A line's
    two end bays are joined by a `transmission` edge (power) *and* its
    two protection IEDs are joined by a `protection` edge (the 87L
    current-differential channel). No earlier pack has two layers meaning
    different things over the same span.
- **Audience focus: reliability and contingency.** The headline KPI at
  every level above a bay is `worst_post_ctg_loading_pct` — the worst
  N-1 post-contingency loading as a percentage of emergency rating,
  which is what a real-time contingency analysis produces [1][2].
  Condition signals (transformer thermal and DGA, bushing power factor,
  SF₆, OLTC wear) carry the slow-burn scenarios underneath.
- **Timeline:** the spec default, **2026-08-28, 08:00–14:05 at 5-minute
  steps** (74 points) — the same demo day as ccgt, pipeline and pharma.
  A hot late-August morning is the physically right setting: summer
  demand has "a distinct single-peak load shape" reaching its maximum
  "around 5:00 p.m. or 6:00 p.m." [16][17], so a window ending at 14:05
  sits on the rising side of the ramp with the peak still ahead. That is
  exactly the state in which contingency margin matters.
- **Units:** US customary as a US control room shows them — MW, MVAr, A,
  kV, per unit, MVA, °C for equipment temperatures.

---

## 1. Process overview

A transmission network moves bulk power from where it is generated to
where it is consumed. There is no inventory and no storage: production
and consumption balance continuously, and the operator's job is to keep
every element inside its thermal, voltage and stability limits while
that balance shifts through the day.

Vesper Grid has three tiers:

1. **345 kV backbone (Keldon District).** Four bulk substations —
   Aldergate, Wyndham, Kessler, Thorne — connected as a ring with one
   diagonal. Generation enters at Aldergate (Halcyon Point, gas-fired)
   and Thorne (Boreas Ridge, wind). Each bulk substation steps down to
   138 kV through one or two autotransformers.
2. **138 kV sub-transmission (Harrow District).** Five stations —
   Bexhill, Orrin, Larkspur, Wexford, Colvin — each fed from two
   different 345 kV sources where possible, and tied to each other so
   that the 138 kV network is itself looped. Each steps down to 69 kV.
3. **69 kV supply (Sanbourne District).** Four stations — Pell, Navarre,
   Dunmore, Tilbury — each serving distribution load. The 69 kV network
   runs **radially with a normally-open tie** between Navarre and
   Dunmore, which is the standard arrangement: a loop "operates
   'normally open' at one or more tie points to maintain simple fault
   levels and directional protection", and "under contingency,
   automatic transfer closes the tie and opens a faulted section" [15].

Power flows down the voltage tiers, but *within* a tier it divides by
impedance, not by intent. That single fact is what makes the pack's
topology matter: when an element is lost, the flow it was carrying does
not disappear — it reappears somewhere the operator did not choose.

### 1.1 What the control room does with it

- The state estimator and **real-time contingency analysis** run
  continuously; PJM documents RTCA running "approximately every 1-2
  minutes" [2], while the compliance obligation is a **Real-time
  Assessment "at least once every 30 minutes"** [1].
- When a **System Operating Limit** is exceeded, the operator initiates
  an Operating Plan [1]; the fixed 30-minute clock applies specifically
  to **IROL** exceedances — "Each Interconnection Reliability Operating
  Limit's Tv shall be less than or equal to 30 minutes" [3].
- Mitigation escalates in a published order: adjust phase angle
  regulators → switch reactive devices or adjust generator MVAr →
  **switch transmission facilities in or out of service** →
  redispatch generation → adjust imports/exports → issue a TLR [4].
  The third step is the reconfiguration this pack models.

---

## 2. The natural hierarchy

Utilities describe a substation from the outside in: a **station**
contains **bays** (one breaker position per circuit, transformer, bus or
capacitor bank), a bay contains **devices** (breaker, transformer,
instrument transformer, protective relay), and a device may contain
monitored **components** (tap changer, bushings, cooling group, trip
coil). Above the station, work is organised by **operating district**.

The pack therefore declares six levels:

| Level | Count | Examples |
|---|---|---|
| `network` | 1 | Vesper Grid |
| `district` | 3 | Keldon, Harrow, Sanbourne |
| `substation` | 13 | Aldergate, Larkspur, Dunmore |
| `bay` | ~90 | "Wyndham 345 kV Line", "T1 Transformer", "138 kV Bus" |
| `device` | ~150 | breakers, autotransformers, CVTs, IEDs, batteries |
| `component` | ~45 | OLTC, bushing set, cooling group, DGA monitor, trip coil |

### 2.1 The unit of operation

`unitLevel: substation`. A transmission operator says "Larkspur is in
trouble", not "bay 3 is in trouble" — the station is the thing that gets
a name on the wall, a crew dispatched to it and a line on the outage
log. Thirteen units fits the Now strip's ≤ 24 budget with room spare.

An honest alternative was the **circuit** (the line between two
stations), because contingency analysis is element-based. It was
rejected for two reasons: a circuit has no natural place in a
containment tree (it is *between* two parents), and 13 substations plus
12 circuits would be 25 units, over budget. Instead — see §2.3 — a
circuit is modelled as the **edge between its two end bays**, which is
also how a substation-oriented SCADA system sees it.

### 2.2 Where the branches really differ

Heterogeneity is deliberate and follows the real equipment:

- **Three substation types.** `bulk_substation` (345/138 kV, ring bus,
  autotransformers, reactive plant), `subtransmission_substation`
  (138/69 kV), `supply_substation` (69 kV, serving load, no
  transformation). Each is its own type because the child bays genuinely
  differ, per spec §3.1's "the asset itself is different" test.
- **Two breaker types.** `monitored_breaker` carries an online trip-coil
  and mechanism monitor and therefore has `trip_coil` and
  `breaker_mechanism` children; `sf6_breaker` is the same primary plant
  with no online monitoring and no children. That is a real fleet split
  — monitoring is retrofitted to the important positions first — and it
  is the spec's "geared turbine has a gearbox, direct-drive doesn't"
  case, so it is two types rather than one type with mixed children.
- **Only transformers have components.** A transformer carries four
  monitored components (OLTC, bushing set, cooling group, DGA monitor);
  most devices are leaves at the device level. Leaves therefore sit at
  the bay, device and component levels.
- **Bay counts differ per station.** Aldergate has ten bays (two
  autotransformers, a generator tie, three 345 kV circuits); Tilbury has
  four. Nothing is padded to make the branches match.

### 2.3 Circuits are edges, not assets

Each transmission circuit appears as **one `line_bay` at each end plus
one relationship edge between them**. Consequences, all of them
intentional:

- A circuit outage shows at **both** ends, which is what an operator
  sees on a real one-line.
- The two ends' MW readings differ slightly — by line losses; AEP gives
  345 kV losses of "42.5" MW per 100 miles at 1,000 MW [18] — so the
  pack's two ends of a circuit are deliberately **not** identical
  numbers.
- All the topology lives in `asset-relationships.json`, so the All
  Assets diagram *is* the one-line diagram.

---

## 3. KPIs and properties

### 3.1 The headline KPI: worst post-contingency loading

`worst_post_ctg_loading_pct` — for each element, the highest loading it
would reach, as a percentage of its **emergency** rating, under the worst
single contingency in the study set. Pre-contingency means "actual flows
and voltages on the system as indicated by SCADA systems or state
estimators"; post-contingency means "a calculation or simulation of the
expected state of the system if a Contingency were to occur" [5]. It
rolls up as a **max**, not an average: a district is as exposed as its
worst element. Bands used in the pack, from published practice:

- **< 95 %** — normal. PJM propagates constraints into its dispatch
  above 95 %: "Constraints above 95% shall be propagated into SCED" [2].
- **95–100 %** — advisory; the element is inside its emergency rating
  post-contingency but there is no margin left.
- **> 100 %** — an SOL exceedance post-contingency; the operator owes an
  Operating Plan [1].

Ratings themselves are modelled as **absolute MVA numbers**
(`normal_rating_mva`, `emergency_rating_mva`, both static), not as
percentages of each other, because FAC-008-5 requires both a Normal and
an Emergency Rating but publishes no ratio [6]. The *durations* are
published — ISO-NE's ladder is Normal (continuous), LTE 12 hours in
summer, STE 15 minutes [7] — and those appear in the scenario text, not
in the data.

### 3.2 Property kits by equipment type

Reusable kits, in the spirit of spec §3.3's pump and tank kits:

| Kit | Properties |
|---|---|
| **EHV line bay** (345 kV) | `ehv_mw_flow_mw`, `ehv_mvar_flow_mvar`, `ehv_current_a`, `loading_pct`, `post_ctg_loading_pct`, `normal_rating_mva`*, `emergency_rating_mva`* |
| **HV line bay** (138 kV) | `mw_flow_mw`, `mvar_flow_mvar`, `line_current_a`, `loading_pct`, `post_ctg_loading_pct`, `normal_rating_mva`*, `emergency_rating_mva`* |
| **Sub-transmission bay** (69 kV) | `sub_mw_flow_mw`, `sub_mvar_flow_mvar`, `sub_current_a`, `loading_pct`, `post_ctg_loading_pct`, `normal_rating_mva`*, `emergency_rating_mva`* |
| **Autotransformer** (345/138 kV) | `auto_load_mva`, `xfmr_loading_pct`, `top_oil_temp_c`, `winding_hotspot_temp_c`, `rated_mva`* |
| **Power transformer** (138/69 kV) | `xfmr_load_mva`, `xfmr_loading_pct`, `top_oil_temp_c`, `winding_hotspot_temp_c`, `rated_mva`* |
| **SF₆ breaker** | `sf6_pressure_kpa`, `breaker_ops_total`, `accum_interrupt_i2t_ka2s`, `contact_wear_pct`, `reclose_ops_count` |
| **Bus section** | `bus_voltage_pu`, `bus_voltage_thd_pct`, `neg_seq_voltage_pct`, `nominal_kv`* |
| **CVT** | `cvt_secondary_v`, `v_redundant_dev_pct`, `cvt_pf_pct`, `cvt_cap_dev_pct` |
| **Protection IED** | `goose_msg_age_ms`, `line_diff_latency_ms`, `diff_current_pu`, `relay_selftest_faults_n` |
| **Station battery** | `battery_float_voltage_v`, `battery_cell_dev_v`, `charger_output_current_a`, `charger_ac_ripple_pct` |
| **OLTC** | `tap_position`, `oltc_ops_per_day`, `oltc_ops_total`, `ltc_tank_diff_temp_c` |
| **Bushing set** | `bushing_c1_pf_pct`, `bushing_cap_dev_pct`, `bushing_leakage_current_ma` |
| **Cooling group** | `cooling_fans_running_n`, `oil_pump_flow_pct`, `radiator_dt_c` |
| **DGA monitor** | `dga_h2_ppm`, `dga_c2h4_ppm`, `dga_c2h2_ppm`, `dga_tdcg_ppm`, `dga_tdcg_rate_ppm_day`, `moisture_rel_sat_pct` |

`*` = static (nameplate); no time series, per spec §3.3.

MW and MVAr keys are **split by voltage class** (`ehv_mw_flow_mw` /
`mw_flow_mw` / `sub_mw_flow_mw`) for the reason spec §3.3 gives about
`motor_current_a` versus `process_motor_current_a`: a 345 kV circuit
carries 400–700 MW and a 69 kV circuit 25–40 MW, and one shared gauge
range would make one of them unreadable. `loading_pct` and
`post_ctg_loading_pct` are **not** split — as percentages of each
element's own rating they mean the same thing everywhere, which is
precisely why control rooms trend them.

### 3.3 Sourced normal values and ranges

| Property | Unit | Normal | Range | Basis |
|---|---|---|---|---|
| `bus_voltage_pu` | pu | 1.005–1.03 | [0.90, 1.10] | 0.95–1.05 pu pre-contingency, 0.92–1.05 post [8] |
| `bus_voltage_thd_pct` | % | 0.8–1.2 | [0, 5] | IEEE 519-2022: 1.5 % THD above 161 kV, 2.5 % for 69–161 kV [9] |
| `system_frequency_hz` | Hz | 59.99–60.01 | [59.9, 60.1] | Eastern Interconnection ε₁ = "18.0 mHz" [10] |
| `top_oil_temp_c` | °C | 55–75 | [0, 120] | monitor alert band 85–90 °C, alarm 95–100 °C [11] |
| `winding_hotspot_temp_c` | °C | 70–95 | [0, 150] | 110 °C continuous for 65 °C-rise units [12]; IEC normal cyclic limit "Hot spot ≤ 120°C" [13] |
| `xfmr_loading_pct` | % | 55–95 | [0, 150] | emergency ≥ 100 % of nameplate; 65 °C units may run "at 120% for an 8 hour peak load cycle" [14] |
| `sf6_pressure_kpa` | kPa (rel., 20 °C) | 640–660 | [400, 800] | GE Vernova GL314: rated 0.65 MPa, alarm 0.54 MPa, lockout 0.51 MPa [19] |
| `dga_tdcg_ppm` | ppm | 180–320 | [0, 720] | IEEE condition-1 ceiling 720 ppm TDCG [20] |
| `dga_tdcg_rate_ppm_day` | ppm/day | 1–4 | [0, 40] | > 30 ppm/day is the action rate — "Consider removal from service" [20] |
| `dga_c2h2_ppm` | ppm | 0–0.6 | [0, 10] | acetylene normal is "< 1 PPM" [21]; deliberately **not** mid-scale (§6) |
| `bushing_c1_pf_pct` | % | 0.30–0.45 | [0, 1.5] | new OIP bushings "below 0.5% power factor on C1"; above 1.0 % remove at next outage [22] |
| `bushing_cap_dev_pct` | % | 0.2–0.6 | [0, 10] | investigate above 5 % shift from factory value [22]; online concern "3–5% drift" [23] |
| `tap_position` | step | −4 … +6 | [−16, 16] | ANSI ±10 % in 0.625 % steps = 32 steps [24][25] |
| `oltc_ops_per_day` | ops/day | 4–8 | [0, 80] | healthy 12,000–13,000 ops/yr/phase ≈ 35/day across three phases; hunting case ≈ 80,000/yr [26] |
| `battery_float_voltage_v` | V | 130–134 | [110, 145] | 2.25–2.30 V/cell float on a 58–60 cell string [27] |
| `line_diff_latency_ms` | ms | 4–7 | [0, 15] | "Typical requirements for 87L channel latency are in the range of 5 to 10 milliseconds" [28] |
| `goose_msg_age_ms` | ms | 2–5 | [0, 12] | Type 1A trip class "P1 10 ms", "P2/P3 3 ms"; measured max 7 ms [29] |
| `v_redundant_dev_pct` | % | 0.1–0.6 | [0, 10] | alarm at "a difference of 0.05 pu between Relay 1 and Relay 2 magnitudes" = 5 % [30] |

Line and transformer magnitudes (MW, A, MVA) are engineering arithmetic
from S = √3·V·I with conventional ACSR currents, not published figures —
see §6.

### 3.4 Tiers

Roughly 35 % P1 / 45 % P2 / 20 % P3, as the spec asks. P1 is what a
transmission operator has on the wall: `post_ctg_loading_pct`,
`loading_pct`, `bus_voltage_pu`, MW flow, `xfmr_loading_pct`,
`winding_hotspot_temp_c`. P3 holds nameplate statics and the slow
condition indices an engineer opens deliberately.

### 3.5 Rollups

Three derived keys, all exact aggregates so the validator can check them
at every time point:

| Key | Rule |
|---|---|
| `worst_post_ctg_loading_pct` | `max` of `post_ctg_loading_pct` over descendant line bays — at substation, district and network level |
| `served_load_mw` | `sum` of `served_load_mw` over descendant load bays — at supply substation, supply district and network level |
| `n1_violations_n` | count of elements whose post-contingency loading exceeds 100 %. Declared `"fn": "formula"` with a note, because it is a count of a *condition*, which the validator's `count` cannot express |

The network root also carries the two signals that belong to nobody in
particular: `system_frequency_hz` and `ambient_temp_c`.

---

## 4. Relationships

Eight layers, chosen so that the same span can be meaningful in more
than one of them:

| Layer | What it connects |
|---|---|
| `transmission` | 345 kV circuits, end bay to end bay |
| `subtransmission` | 138 kV circuits |
| `supply` | 69 kV circuits, including the **normally-open tie** |
| `station_bus` | a bay to the bus section it is connected to |
| `transformation` | high-side bus → transformer → low-side bus |
| `protection` | an IED to the breaker it trips, and IED ↔ IED for a line's 87L current-differential channel |
| `dc_supply` | the station battery to the breakers and IEDs it supplies |
| `reactive_support` | capacitor bank or reactor to its bus |

Notes that matter for reading the diagram:

- **Cycles are real and intended.** Aldergate → Wyndham → Kessler →
  Thorne → Aldergate is a ring; Aldergate → Kessler closes a second
  loop; the 138 kV network has its own two loops. This is the pack's
  reason to exist.
- **The 87L channel parallels the circuit.** For each line, the
  `transmission`/`subtransmission` edge between the end bays and the
  `protection` edge between the end IEDs describe the same span and
  behave completely differently — the channel can degrade while the
  circuit is healthy (§5.10), which is a real and frequently-missed
  failure mode.
- **The normally-open tie is an edge with a label.** Navarre ↔ Dunmore
  carries `label: "69 kV tie — normally open; closed 11:20"`. The
  topology change lives in the telemetry and in the scenario's
  `whatChanged`, and the edge is what tells you where it could go.
- **`dc_supply` fans out from one asset to many across bays.** One
  battery feeds every trip coil in the station, which is why a battery
  problem is a station-wide protection problem and not a bay problem.

---

## 5. Failure modes

Twelve documented modes, each mapped to a scenario in `SCENARIOS.md`.

### 5.1 Bushing deterioration (→ scenario 01, archetype 05)

**Asset:** 345 kV condenser bushing on an autotransformer. **Cause:**
moisture ingress or partial discharge in the condenser core shorting
grading layers. **First symptom:** `bushing_c1_pf_pct` rises from its own
baseline and `bushing_cap_dev_pct` drifts up — shorted layers *increase*
capacitance. Offline criterion: investigate above "more than 5% from the
factory value"; a bushing above 1.0 % C1 power factor "should come out at
the next planned outage" and above 2.0 % "do not wait" [22]. Online
monitors flag "3–5 % drift from baseline" [23]. **Spread:** the failure
is the transformer's — bushings account for a large share of major
transformer failures [23]. **Confirm:** Doble power factor and
capacitance corrected to 20 °C, against nameplate and the sister phases.
**Fix:** replace the bushing. **Timescale:** highly variable, and that
variability is the point — monitored cases range from about ten days of
warning down to seven minutes [31].

### 5.2 Slow internal thermal fault (→ scenario 02, archetype 03)

**Asset:** autotransformer winding or lead. **Cause:** a loose joint or
blocked duct producing a local hot spot. **First symptom:**
`dga_c2h4_ppm` and `dga_h2_ppm` climb together while `dga_c2h2_ppm`
stays flat — "High CH4, C2H6, and C2H4" indicates thermal faults, while
acetylene indicates arcing [32]. The rate is what matters:
`dga_tdcg_rate_ppm_day` crossing 30 ppm/day is the published action
level [20]. **Spread:** carbonised paper raises CO/CO₂ later; unchecked
it ends as a dielectric failure. **Confirm:** resample and confirm the
rate, then Duval triangle. **Fix:** internal inspection at an outage.
**Timescale:** weeks to months, which is why a six-hour window shows
only the trend and not the ending.

### 5.3 CVT capacitor element failure (→ scenario 03, archetype 06)

**Asset:** 138 kV coupling-capacitor voltage transformer. **Cause:**
elements in the capacitor stack shorting, or moisture in the stack:
"Single or multiple failures can occur in the capacitor stack causing a
decrease in ratio and an increase in phase error" [33]. **First
symptom:** one phase's `cvt_secondary_v` drifts away from the redundant
relay while **nothing else moves** — MW, MVAr, current and the adjacent
bus all stay put. **Confirm:** the redundant-measurement cross-check,
alarming on "a difference of 0.05 pu between Relay 1 and Relay 2
magnitudes" with "a 10° alarm threshold" on angle [30]; offline,
capacitance should be "within 1 % - 2 % of nameplate" [33]. **Fix:**
replace the CVT; meanwhile block any automatic voltage control that uses
it. **Why it is the instrument-fault scenario:** a genuine voltage change
moves every measurement together; an instrument fault moves one. If the
false reading is believed, the OLTC and capacitor banks will chase a
voltage that was never wrong and *actually* move the bus off-nominal.

### 5.4 Tap changer hunting (→ scenario 04, archetype 10)

**Asset:** OLTC plus its voltage-regulating relay. **Cause:** bandwidth
set narrower than two tap steps, or two paralleled banks whose controls
fight each other. "In order to avoid hunting, regulators require a
bandwidth equal to at least 2 steps (1.25%)" [26], and bandwidth is
what "prevents hunting—the rapid cycling between tap positions" [34].
**First symptom:** `oltc_ops_per_day` jumps several-fold with
`tap_position` oscillating ±1–2 and no net drift, while the regulated
voltage stays *inside* band the whole time — nothing looks wrong on the
voltage gauge. **Spread:** a maintenance interval of "between 50,000 and
100,000 operations" [35] gets consumed in a fraction of its intended
years, and contact coking follows. **Confirm:** plot tap position
against voltage; compare bandwidth in volts against two step sizes;
check the parallel unit for counter-phase tapping. **Fix:** widen the
bandwidth, lengthen the time delay, fix the paralleling scheme.
**Timescale:** damage accrues over months; the signature is visible
within one day.

### 5.5 Line fault, failed reclose, lockout (→ scenario 05, archetype 11)

**Asset:** a 138 kV circuit. **Cause:** lightning, contamination or
contact — "About 85-95% of faults in transmission and distribution
networks are temporary" [36], so most clear on the first reclose; this
one does not. **First symptom:** flow to zero in one step, with the
breaker's `breaker_ops_total`, `reclose_ops_count` and
`accum_interrupt_i2t_ka2s` stepping at the same instant. **Sequence:**
rapid reclose dead time of "about 20 cycles or 0.4s", or delayed
reclosing of "about 5-30s" [36]; when attempts are exhausted the lockout
relay operates and the element stays out until reset in the field.
**Consequence that matters:** the element is now out of service, so the
**contingency set changes** — every remaining path is carrying more, and
the next contingency is worse than it was an hour ago. **Confirm:**
relay event report, fault location, line patrol. **Timescale:**
milliseconds for the event, hours for the patrol and repair.

### 5.6 Flow redistribution after an element loss (→ scenario 06, archetype 09)

**Asset:** the parallel paths around the lost element. **Cause:** flow
divides by impedance. The canonical sequence is 14 August 2003:
Harding–Chamberlin tripped "at 44% or its emergency rating", then
Hanna–Juniper "at 88% of its emergency rating", then "the first of
sixteen 138-kV lines in FirstEnergy's system began to trip", then
Star–South Canton "failed at 93% of its rating" [37]; the official report
records that "the loss of some of FE's key 345-kV lines in northern Ohio
caused its underlying network of 138-kV lines to begin to fail" [38].
**First symptom:** loading on the parallel path steps up within one
scan, then keeps climbing as load rises. **Spread:** downward — surplus
flow drops onto the lower-voltage network that was never sized for it.
**Confirm:** compare measured flows against the contingency analysis's
predicted post-contingency flows. **Fix:** the mitigation ladder in §1.1
[4]. **Timescale:** the redistribution is instantaneous; the overload
develops over the following hour as load rises.

### 5.7 Voltage sag from an upstream reactive loss (→ scenario 07, archetype 07)

**Asset:** a 69 kV bus two stations downstream of the cause. **Cause:** a
138 kV shunt capacitor bank trips on neutral unbalance; the reactive
support it was providing disappears and voltage falls furthest at the
electrically weakest point, which is not where the bank was.
**First symptom:** `bus_voltage_pu` at the downstream bus sags toward the
0.95 pu pre-contingency floor [8] while the bank's own bus barely moves.
**Confirm:** compare the timing — the downstream sag and the upstream
bank's status change are in the same scan — and check MVAr flows rather
than voltages. **Fix:** restore reactive support, or raise taps as an
interim. **Why it is the ghost-signal scenario:** the alarm is at
Dunmore and the cause is at Wyndham, two voltage levels and two stations
away.

### 5.8 Capacitor can and fuse failure (the cause behind 5.7)

**Asset:** a 138 kV wye shunt capacitor bank. **Cause:** an element's
dielectric breaks down and blows its fuse. **First symptom:** a
**discrete step** in `cap_neutral_unbal_a` that does not return — not a
ramp; that distinction is the diagnosis. **Spread:** cascading by
design — each failure raises the voltage on the survivors, so banks are
built with "at least 10 elements in series" and more than ten units in
parallel to hold the remaining units inside the "110 percent
overvoltage" limit [39]. The alarm is deliberately "set to function at
about one-half the level of the unbalance signal" [40], so the first
failure alarms and the second trips. **Timescale:** the step is
instantaneous; the interval between successive failures shortens.

### 5.9 Recurring momentary faults (→ scenario 08, archetype 12)

**Asset:** one 69 kV circuit and its breaker. **Cause:** vegetation,
wildlife or contamination producing repeated temporary faults that
auto-reclose clears. Momentary outages last "less than one minute" and
sustained ones "longer than one minute" [41]; in the TADS data,
"Lightning, Contamination, and Unknown caused 73% of momentary outages"
[42]. **First symptom:** `reclose_ops_count` stepping up several times
in a shift on one circuit while every individual event is invisible —
service was never interrupted. Meanwhile `accum_interrupt_i2t_ka2s` and
`contact_wear_pct` climb, because arc energy scales with the square of
interrupted current. **Confirm:** correlate the event times with weather
and with a line patrol; compare against the same circuit's normal rate.
**Fix:** patrol and clear the cause before it becomes permanent.

### 5.10 Line differential channel degradation (→ scenario 11 evidence)

**Asset:** an 87L relay pair and its fibre channel. **Cause:** a
protection-path reroute onto a longer route. **First symptom:**
`line_diff_latency_ms` steps up past the "range of 5 to 10 milliseconds"
typical spec, and asymmetry appears [28]. **Spread:** asymmetry creates
a *phantom* differential current on a healthy line — "1 electrical degree
yields a spurious differential current of less than 1 percent of the
through current" — and at high through-current that scales toward a
trip. **Why it belongs here:** communications failures are the third
largest misoperation cause, at about 10 % of the WECC 2023 total [43],
behind incorrect settings/logic/design at about 36 % and relay failures
at about 21 %.

### 5.11 Transformer thermal overload on a hot day (→ scenario 09, archetype 04)

**Asset:** a 345/138 kV autotransformer. **Cause:** redistributed flow
plus rising ambient. **First symptom:** `winding_hotspot_temp_c` climbs
past 105 °C while `xfmr_loading_pct` sits above 100 % and every cooling
stage is already running — heat accumulates rather than steps. Hot-spot
limits: 110 °C continuous for 65 °C-rise units [12], IEC's normal cyclic
"Hot spot ≤ 120°C" [13], and aging that "doubles for every 6°C rise"
[13]. **Spread:** derating pushes flow to the parallel bank, whose own
temperature then rises. **Confirm:** cross-check the winding temperature
indicator against the hot spot calculated from load and ambient, and
verify every cooling stage actually ran. **Fix:** transfer or redispatch;
the 65 °C-rise allowance of "120% for an 8 hour peak load cycle" costs
"0.25% loss of life" [14]. **Timescale:** 30–90 minutes.

### 5.12 Loop switching to relieve an element (→ scenario 06's mitigation, and 5.7's interim fix)

**Asset:** the normally-open 69 kV tie. **Cause:** deliberate operator
action, third on the published mitigation ladder [4]. **What it costs:**
three things, all real [15] — fault duty rises at the tie point; radial
protection coordination, which is "comparatively straightforward"
precisely because flow is one-way, is no longer straightforward; and
once closed, flow divides by impedance so load transferred off one
element can end up loading a third. **In the pack:** closing
Navarre–Dunmore at 11:20 takes 11 MW off Larkspur's transformer and puts
about 7 MW of it onto Bexhill's, which is the honest outcome and a
better demo than a clean transfer would be.

---

## 6. Normal-operation context, and what could not be verified

**Operating modes.** Substations run `STEADY`; one on the rising edge of
the ramp is `RAMP_UP`; one holding a restricted configuration after the
lockout is `CONTROLLED_HOLD`; one with a planned clearance in progress is
`MAINTENANCE`; the station being switched onto the closed tie is
`CHANGEOVER`. All five are in the spec's colored set, so no mode falls
back to neutral.

**Routine work.** The work items come from published intervals: monthly
substation inspections (PG&E reports Type 1 substations "inspected
monthly" under CPUC GO 174 [44]); station battery checks every "4
Calendar Months" and unmonitored relay testing every "6 Calendar Years"
under PRC-005-6 [45]; annual transformer DGA and infrared scans under
USBR FIST 3-30 [46]; annual vegetation inspection with "no more than 18
calendar months between inspections on the same ROW" under FAC-003-5
[47]; and the clearance lifecycle — switching order, visible break, test
for absence of voltage, ground, tag, issue, release — from OSHA
1910.269, which requires that before work "the person in charge at the
work site must review the isolation steps with all workers" [48].

**Roles.** Transmission Operator (NERC-certified, in the control room),
Field Switchman, Substation Technician, Relay Technician, System
Planner [49]. These are the `assignedRole` values in `work-items.json`.

**Deliberately not modelled.** SAIDI/SAIFI/CAIDI are *distribution*
indices — they measure customer interruptions a transmission operator
does not own, and putting them on a transmission HMI is a common demo
mistake. The pack uses element-based measures instead.

**Could not be verified, and therefore not used as if sourced:**

- The ratio of emergency to normal rating. The durations are published
  [7]; the percentages are not, so ratings are absolute MVA numbers and
  the pack never claims "emergency = 115 % of normal".
- Conductor ampacity tables. MW, A and MVA magnitudes are arithmetic
  from S = √3·V·I at conventional ACSR currents — engineering-plausible,
  not cited.
- Any numeric MVAr reserve threshold. The NERC reactive guideline gives
  no real-time number, so scenario 10's reserve margin is presented as
  this utility's own operating target, not a standard.
- Absolute breaker contact-resistance limits, trip-coil peak current and
  per-model operating times — every source defers to the nameplate, so
  the pack trends them against each breaker's own baseline.
- A numeric LTC-to-main-tank differential temperature alarm point, and
  a quantitative "sags are seen within N miles" rule. Neither exists in
  the sources; the sag scenario therefore has every bus registering the
  disturbance in the **same scan**, with depth set by electrical
  distance, because sags do not travel outward over seconds.
- Three keys deliberately break the "normal sits mid-scale" guidance
  because a mid-scale normal would be physically wrong:
  `dga_c2h2_ppm` (acetylene should be near zero), `cap_neutral_unbal_a`
  and `relay_selftest_faults_n` (defect counters).

---

## 7. Sources

1. NERC TOP-001-6 — https://www.nerc.com/globalassets/standards/reliability-standards/top/top-001-6.pdf
2. PJM Manual 37, Reliability Coordination — https://www.pjm.com/-/media/DotCom/documents/manuals/m37.pdf
3. NERC Glossary of Terms — https://www.bchydro.com/content/dam/BCHydro/customer-portal/documents/transmission/reliability/Glossary-of-Terms-2020-10-08.pdf
4. PJM Manual 3, Transmission Operations — https://www.pjm.com/-/media/DotCom/documents/manuals/m03.pdf
5. NERC SOL White Paper — https://www.nerc.com/globalassets/standards/projects/2015-09/nerc-sol-white-paper_clean.pdf
6. NERC FAC-008-5 — https://www.nerc.com/globalassets/standards/reliability-standards/fac/fac-008-5.pdf
7. ISO-NE Planning Procedure 7 (ratings and durations) — https://www.iso-ne.com/static-assets/documents/rules_proceds/isone_plan/pp07/pp7_final.pdf
8. AEP Planning Criteria (PJM), pre/post-contingency voltage bands — https://www.pjm.com/-/media/DotCom/planning/planning-criteria/aep-planning-criteria.ashx
9. IEEE 519-2022 voltage distortion limits (summary) — https://powerquality.blog/2023/06/01/power-quality-ieee-519-2022/
10. NERC Balancing and Frequency Control Reference Document — https://www.nerc.com/globalassets/who-we-are/standing-committees/rstc/rs/reference_document_nerc_balancing_and_frequency_control.pdf
11. Transformer temperature monitoring alert/alarm bands — https://www.fjinno.net/transformer-temperature-monitoring-and-cooling-control-essential-practices-for-power-system-reliability/
12. Permissible loading of transformers (IEEE C57.91 summary) — https://pdhonline.com/courses/e215/Permisible_Loading_of_XFMR_s_and_Regulators.pdf
13. IEC 60076-7 hot-spot and aging summary — https://industrialmonitordirect.com/blogs/knowledgebase/iec-60076-7-transformer-loss-of-life-hot-spot-temperature-aging
14. SPP Planning Criteria §7.2 (conductor and transformer ratings) — https://www.spp.org/documents/38981/section%207_2%20from%20spp%20effective%202016%20planning%20criteria%20with%20highlights.pdf
15. Distribution system topologies, radial and normally-open ties — https://eepower.com/technical-articles/distribution-system-fundamentals-part-2-topologies-and-reliability/
16. EIA, summer vs winter load shape — https://www.eia.gov/todayinenergy/detail.php?id=46117
17. EIA, hourly demand peaks late afternoon — https://www.eia.gov/todayinenergy/detail.php?id=42915
18. AEP Transmission Facts (345 kV capability and losses) — https://web.ecs.baylor.edu/faculty/grady/_13_EE392J_2_Spring11_AEP_Transmission_Facts.pdf
19. GE Vernova GL314 SF₆ breaker instruction manual (pressure ladder) — https://www.gevernova.com/grid-solutions/products/manuals/iti/cbr/gl314p/instruction%20d1530_en_04.pdf
20. IEEE dissolved-gas-analysis guidelines (condition table and TDCG rates) — https://facilityresults.com/wp-content/uploads/2019/10/FR-IEEE-DISSOLVED-GAS-ANALYSIS-GUIDELINES.pdf
21. DGA limits, normal acetylene level — https://elscotransformers.com/blog/dissolved-gas-analysis-limits/
22. Bushing power factor and capacitance criteria — https://southernswitch.com/learn/bushing-power-factor-capacitance
23. Bushing monitoring technologies and failure modes — https://www.fjinno.net/transformer-bushing-monitoring-technologies-failure-modes-and-early-warning-methods/
24. ANSI load tap changing transformers (±10 %, 0.625 % steps) — https://www.eng-tips.com/threads/ansi-load-tap-changing-transformers.478261/
25. Iowa State EE455, modelling voltage regulators — https://wzy.ece.iastate.edu/Courses/EE455/08%20EE455%20Modeling%20Voltage%20Regulators.pdf
26. Substation voltage regulator hunting, real operation counts — https://www.eng-tips.com/threads/substation-voltage-regulator.487732/
27. 125 VDC battery and charger float guide — https://industrialmonitordirect.com/blogs/knowledgebase/125vdc-power-distribution-battery-charger-float-charging-guide
28. SEL, communications and data synchronization for 87L schemes — https://cdn.selinc.com/assets/Literature/Publications/Technical%20Papers/6492_CommunicationsData_BK_20110906_Web.pdf
29. ABB, IEC 61850 GOOSE in protection applications — https://library.e.abb.com/public/dc853877595c4086ae649ca29924c0ec/Paper_GOOSE%20Utilisation%20in%20Protection.pdf
30. SEL, substation instrument transformer early failure detection — https://selinc.com/api/download/138750/?lang=en
31. Treetech, rapid and very rapid evolution of bushing flaws — https://treetech.com.br/en/rapid-and-very-rapid-evolution-of-bushing-flaws-detected-by-online-monitoring/
32. DGA benchmark values and fault-type interpretation — https://industrialmonitordirect.com/blogs/knowledgebase/dga-transformer-oil-analysis-ieee-c57104-benchmark-values
33. Megger, coupling capacitor voltage transformers (CCVTs) — https://www.megger.com/en/et-online/may-2023/coupling-capacitor-voltage-transformers-(ccvts)
34. Load tap changer bandwidth settings — https://industrialmonitordirect.com/blogs/knowledgebase/load-tap-changer-bandwidth-settings-on-power-transformers
35. Reinhausen, on-load tap changers for power transformers — https://www.reinhausen.com/fileadmin/downloadcenter/company/publikationen/f0126405_on-load_tap-changers_for_power_transformers.pdf
36. UNM/SUMMA Lightning Memo 2 (temporary faults, reclose timing) — https://summa.unm.edu/notes/LightningMemos/LM2.pdf
37. MIT OCW 6.691, The August 2003 Blackout — https://ocw.mit.edu/courses/6-691-seminar-in-electric-power-systems-spring-2006/5a75120955cfe89195ab495247368229_blackout_2003.pdf
38. US–Canada Power System Outage Task Force report — https://www.ferc.gov/sites/default/files/2020-05/blackout-report.pdf
39. SEL, principles of shunt capacitor bank application and protection — https://selinc.com/api/download/6395/
40. Shunt capacitor bank design and protection basics — https://www.cedengineering.com/userfiles/Shunt%20Capacitor%20Bank%20Design%20and%20Protection%20Basics.pdf
41. ReliabilityFirst 2025 Transmission Outage Assessment — https://www.rfirst.org/wp-content/uploads/2025/10/2025-RF-Transmission-Outage-Assessment.pdf
42. Texas RE / ERCOT ROS TADS review — https://www.ercot.com/files/docs/2014/08/29/08._ros_texas_reliability_entity_review_of_reliability_perfo.pdf
43. WECC 2023 Protection Systems Performance (Misoperations) Report — https://www.wecc.org/sites/default/files/documents/meeting/2024/2023%20Misoperations%20Report.pdf
44. PG&E GO 174 Annual Substation Report 2023 — https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/safety-and-enforcement-division/reports/annual-reports/go-174---annual-substation-reports/2023/2023---go-174-substation-report---pge.pdf
45. NERC PRC-005-6 (protection system maintenance intervals) — https://www.nerc.com/globalassets/standards/reliability-standards/prc/prc-005-6.pdf
46. USBR FIST 3-30, Transformer Maintenance — https://www.usbr.gov/power/data/fist/fist3_30/fist3_30.pdf
47. NERC FAC-003-5 (vegetation management) — https://www.nerc.com/globalassets/standards/reliability-standards/fac/fac-003-5.pdf
48. OSHA eTool, deenergizing lines and equipment — https://www.osha.gov/etools/electric-power/hazardous-energy-control/deenergizing-lines-equipment-employee-protection
49. NERC PER-003-2 (operating personnel credentials) — https://www.nerc.com/pa/Stand/Reliability%20Standards/PER-003-2.pdf
