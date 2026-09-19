# Wind — scenario sheet (Boreas Ridge, 14 Jan 2026)

"Now" is **14:00**. The timeline is 00:00–14:00 at 10-minute steps. Each
scenario's constants live at the top of `generate.py`, and the evidence
points in `attention-items.json` are read back from the generated series,
so this sheet, the data and the narrative agree.

**The day:** a winter front. Wind is about 10.5 m/s overnight, drops to a
lull of about 6 m/s around 08:00, then climbs to 12.8 m/s by 14:00.
Ambient reaches its low of −5 °C at 06:00 and passes 0 °C around 10:30,
in freezing fog (97 % humidity) at dawn.

## Coverage (spec §4.1)

| Item | Archetype | Asset (level) | Outcome at 14:00 |
|---|---|---|---|
| BSIT01 | 05 Component degradation | WTG-05 · Drivetrain · HS Bearing (component) | **open** — investigate, high |
| BSIT02 | 07 Ghost signal | WTG-03 · Generator (subsystem) | resolved |
| BSIT03 | 09 Cascade failure | Feeder 2 (circuit, above unit level) | resolved |
| BSIT04 | 06 Signal noise (instrument) | WTG-12 (turbine) | resolved |
| BSIT05 | 11 Hard block / trip | WTG-09 · Converter (subsystem) | **recovering** |
| BSIT06 | 12 Recurring micro-events | WTG-14 · Rotor · Pitch System (component) | **open** — act, high |
| BSIT07 | 08 Throughput illusion | WTG-17 (turbine) | **open** — investigate |
| BSIT08 | 13 Quality drift (output quality under icing) | WTG-22 (turbine) | resolved |
| BSIT09 | 14 Plan / compliance at risk | Collector Substation (circuit, leaf) | **open** — act, new (15 min) |

9 items and 9 different archetypes, covering 7 turbines plus a feeder and
the substation, across 4 hierarchy levels. 4 are open, 1 recovering and 4
resolved. Archetype 01 (normal) is the rest of the farm, and archetype 02
(busy-but-normal) is the planned work list.

## Scenarios

### BSIT01 — HS bearing degradation (05)

- **Asset:** `BOREAS_F1_WTG05_DRIVETRAIN_HSBRG`. **Primary:**
  `bearing_temp_c`.
- **Story:** from 06:00 the bearing runs progressively hotter than the
  load and ambient model predicts. It is about +14 °C by 14:00 (89 °C
  versus about 75 °C on the other Feeder 1 turbines at the same power).
- **Secondary signals:**
  - gearbox `oil_particle_count` rises from about 3 to 22 particles/h
  - gearbox oil temperature is about +3.5 °C
  - HS bearing vibration is about +0.9 mm/s
- **Why it's realistic:** a temperature residual and a rising debris count
  are the classic SCADA early signature of bearing damage, weeks before
  failure [RESEARCH 2, 3, 8].
- **Ruled out:** a sensor offset (the rise is gradual and a second
  independent signal agrees), and load (the siblings run at the same
  power).
- **Work items:** wk-b11 (borescope and oil sample).

### BSIT02 — Stopped cooling fan shows up as a generator problem (07)

- **Asset:** `BOREAS_F1_WTG03_GENERATOR`. **Primary:**
  `stator_winding_temp_c`. **Root cause:** `…_GENERATOR_FAN`, on the
  `cooling` relationship layer.
- **Timeline:**
  - 09:40 fan current drops to 0 A
  - windings climb about 64 °C, to about 137 °C at 11:10
  - 10:50 the controller applies a 4 % thermal derate
  - 11:20 fan breaker reset
  - windings back to normal by 12:10
- **Ruled out:** a generator fault (load and ambient unchanged; the
  temperature fell as soon as the fan restarted).

### BSIT03 — Pad transformer fault trips Feeder 2 (09)

- **Asset:** `BOREAS_F2` (a feeder, above the unit level, so `unitId`
  is null). **Primary:** `feeder_power_kw`. **Origin:**
  `BOREAS_F2_WTG10_TRAFO`.
- **Timeline:**
  - from 09:20 WTG-10's transformer oil heats about 20 °C with no load
    change
  - 10:10 the feeder breaker trips on ground fault, and all 7 Feeder 2
    turbines drop to 0 kW
  - 10:40 WTG-10 is isolated
  - 10:50 the feeder is re-energised, and 6 turbines are back
  - WTG-10 stays `down` (`STOPPED`)
- **Why it's realistic:** a pad-mount transformer that its own protection
  doesn't clear is a textbook collector-feeder trip [RESEARCH 1, 13].
- **Work items:** wk-b07 (isolate and re-energise, done), wk-b08
  (transformer test and replacement).

### BSIT04 — Iced nacelle anemometer (06)

- **Asset:** `BOREAS_F2_WTG12`. **Primary:** `wind_speed_ms`.
- **Timeline:** 06:40–09:50 the anemometer reads 28–48 % low (for
  example 4.0 m/s against 6.5 m/s at the met mast at 08:20), while power
  tracks the neighbours. Power-curve performance, computed against the bad
  reading, pins at the 130 % ceiling. Heater reset at 09:50.
- **The point:** nothing else corroborates low wind, so it's the
  instrument and not the process [RESEARCH 7, 14].
- **Work items:** wk-b06 (done).

### BSIT05 — Converter trip after condensation (11)

- **Asset:** `BOREAS_F2_WTG09_CONVERTER`. **Primary:**
  `cabinet_humidity_pct`.
- **Timeline:**
  - humidity rises through the cold, low-load morning, from about 55 % to
    72 % by 12:20
  - 12:30 phase-module fault trip on the load ramp, with converter
    temperature normal
  - turbine restarts at 13:10 after cabinet heating
  - humidity falling at 14:00
- **Why it's realistic:** field data shows humidity and condensation,
  not thermal cycling, drive most converter failures, often at part load
  after idle periods [RESEARCH 12].
- **Outcome:** recovering. The unit tile is `running`.

### BSIT06 — Weak pitch battery, repeated safety stops (12)

- **Asset:** `BOREAS_F3_WTG14_ROTOR_PITCH`. **Primary:**
  `pitch_battery_voltage_v`.
- **Timeline:**
  - voltage falls from about 230 V at midnight to 206 V by 14:00 (nominal
    about 238 V)
  - safety stops at 11:50, 12:40, 13:20 and 13:50: each cuts that
    interval's power by about 65 % and sends the pitch toward feather
  - the stops come closer together each time
- **Decision (act):** stop the turbine until the pack is replaced,
  because the blades may not feather on a grid loss [RESEARCH 10].
- **Work items:** wk-b09 (urgent).

### BSIT07 — Static yaw misalignment (08)

- **Asset:** `BOREAS_F3_WTG17`. **Primary:** `power_curve_perf_pct`.
- **Story:** after yesterday's vane replacement the nacelle sits about
  11° off the wind all day. Measured yaw error averages about 0°, because
  the controller trusts the vane. Performance is about 95 % against about
  99 % for its healthy Feeder 3 neighbours, while availability is 100 %.
- **Why it's realistic:** loss grows with cos² of the misalignment, and
  static misalignment is invisible to the controller [RESEARCH 6].
- **Detected at:** 09:00, after a night of data (`sinceMinutes` 300).
- **Work items:** wk-b12.

### BSIT08 — Blade icing on the Feeder 4 ridge (13)

- **Asset:** `BOREAS_F4_WTG22`. **Primary:** `power_curve_perf_pct`.
- **Timeline:** from 04:30 performance declines on all five
  direct-drive turbines, reaching about 78 % on WTG-22 and 87–95 % on
  the others by 07:30. It recovers once ambient crosses 0 °C, and is back
  to normal by 11:00.
- **The point:** a weather-correlated, feeder-wide loss is icing, not a
  machine fault [RESEARCH 7, 14].

### BSIT09 — Curtailment instruction (14)

- **Asset:** `BOREAS_SUB` (a leaf at circuit level). **Primary:**
  `export_power_kw`.
- **Timeline:** the instruction arrives at 13:45 to cap export at 45 MW
  from 14:30. Export is about 53 MW at 14:00 and rising with the wind.
- **Why it's the "new" item:** received 15 minutes ago, it lights the new
  dot [RESEARCH 15, 16].
- **Work items:** wk-b10 (urgent, due 14:20).

## Planned background (archetypes 01/02)

- **WTG-02:** planned gearbox oil change from 08:30. The unit is `down`
  (`MAINTENANCE`), with permit wk-b02 and work wk-b03.
- **Routine work:** shift huddle, met-mast check and substation
  inspection (done).

## Validator warnings and why they're accepted

- `collector_feeder instances have different child types`: Feeder 4
  holds direct-drive turbines, and Feeders 1–3 hold geared ones. A
  container holding a mix is expected (spec §3.1).
- `extra categories: Electrical, Environmental`: wind needs both. They
  list after the standard six.
