// OperatorWorkspace.jsx — Operator Interface (concept shell)
//
// First rapid-prototype pass at the "next-gen Operator interface" concept
// (see design brainstorm — Now / Attention / Work / Investigate, with AI
// woven through rather than living in its own panel/chat window).
//
// SCOPE OF THIS PASS: layout, interaction shape, and visual language only.
// All data below is mocked/static — nothing here is wired to real queries,
// OpHub, or the data-binding system yet. Reuses the Aurelia/Ferrum asset
// hierarchy from assetData.js for realistic naming so it reads as part of
// the same world as the rest of the app.
//
// Four zones:
//   Now         — operational picture: current state of every line, always visible
//   Attention   — ranked list of what needs the operator right now
//   Investigate — drill-down for whatever's selected in Attention (signal →
//                 interpretation → recommendation → evidence)
//   Work        — task list; can be created manually or "recorded" by AI
//
// AI-originated content (as opposed to raw sensor/state data) is marked
// with a small "AI" pill throughout, rather than being confined to a
// separate chat surface — this is the thing the brainstorm doc keeps
// calling out as the actual differentiator vs. a traditional HMI+chatbot.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Splitter } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { SelectBox } from 'devextreme-react/select-box';
import ButtonGroup from 'devextreme-react/button-group';
import {
  CircularGauge, Scale, Label as GaugeValueLabel, Tick, MinorTick,
  RangeContainer, Range, ValueIndicator, Size as GaugeSize, Margin as GaugeMargin,
  Export as GaugeExport, Tooltip as GaugeTooltip,
} from 'devextreme-react/circular-gauge';
import {
  Chart, Series, Point, ArgumentAxis, ValueAxis,
  Grid as ChartGrid, Legend as ChartLegend, Tooltip as ChartTooltip,
  Export as ChartExport, CommonSeriesSettings,
} from 'devextreme-react/chart';

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — "Now" (line status strip)
// ─────────────────────────────────────────────────────────────────────────────

const LINE_STATUS = [
  { id: "AURELIA_A1", label: "Aurelia · A1", state: "running", percent: 90 },
  { id: "AURELIA_A2", label: "Aurelia · A2", state: "running", percent: 92 },
  { id: "AURELIA_A3", label: "Aurelia · A3", state: "attention", percent: 95 },
  { id: "AURELIA_A4", label: "Aurelia · A4", state: "running", percent: 92 },
  { id: "AURELIA_A5", label: "Aurelia · A5", state: "running", percent: 94 },
  { id: "AURELIA_A6", label: "Aurelia · A6", state: "running", percent: 88 },
  { id: "FERRUM_F1", label: "Ferrum · F1", state: "attention", percent: 94 },
  { id: "FERRUM_F2", label: "Ferrum · F2", state: "running", percent: 92 },
  { id: "FERRUM_F3", label: "Ferrum · F3", state: "attention", percent: 93 },
  { id: "FERRUM_F4", label: "Ferrum · F4", state: "attention", percent: 90 },
  { id: "FERRUM_F5", label: "Ferrum · F5", state: "running", percent: 92 },
  { id: "FERRUM_F6", label: "Ferrum · F6", state: "attention", percent: 92 },
];

const STATE_COLORS = {
  running:    '#4ade80',
  attention:  '#fbbf24',
  changeover: '#60a5fa',
  down:       '#f87171',
};

const STATE_LABELS = {
  running: 'Running',
  attention: 'Needs attention',
  changeover: 'Changeover',
  down: 'Down',
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — "Attention" items, each carrying the Investigate detail it
// expands into (Signal → Interpretation → Recommendation → Evidence, per
// the trust-framework shape from the brainstorm doc).
// ─────────────────────────────────────────────────────────────────────────────

const ATTENTION_ITEMS = [
  {
    id: "att-1",
    severity: "high",
    asset: "Ferrum · F1 · Power Charge",
    line: "Ferrum · F1",
    signal: "Recurring high-severity microstops on Power Charge",
    aiInterpretation: "Two episodes today; throughput drops about 15% each time and fully recovers once it clears.",
    since: "15m ago",
    sinceMinutes: 15,
    attentionState: "act",
    detail: {
      signal: "36 microstop events logged on Power Charge today (24 high-severity), in two episodes: 09:14–09:27 and 10:29–10:44.",
      observed: 'Power Charge logged 36 microstop events today, 24 marked high-severity, in two clusters: 09:14–09:27 and 10:29–10:44.',
      derived: 'Throughput fell from a baseline near 160 units/min into the 130s during each cluster — roughly a 15–20% drop — and returned to baseline within a few minutes each time.',
      inferred: 'The repeating, self-resolving pattern suggests an intermittent hardware fault (loose connection, marginal component) rather than a process or operator-driven cause.',
      recommendation: "Inspect Power Charge for a recurring intermittent fault (loose connection, marginal component) rather than treating each occurrence as isolated.",
      evidence: [160.19, 154.69, 150.29, 142.13, 137.78, 136.67, 142.59, 151.16],
      evidencePoints: [
        { time: "09:09", value: "160.2/min", label: "Baseline" },
        { time: "09:12", value: "154.7/min", label: "" },
        { time: "09:15", value: "150.3/min", label: "Episode begins" },
        { time: "09:18", value: "142.1/min", label: "" },
        { time: "09:22", value: "137.8/min", label: "" },
        { time: "09:25", value: "136.7/min", label: "Lowest point" },
        { time: "09:28", value: "142.6/min", label: "Recovering" },
        { time: "09:31", value: "151.2/min", label: "Back to baseline" },
      ],
      relatedOccurrences: [
        { date: "Today, 10:29–10:44", summary: "Same station repeated the identical pattern a second time this shift." },
        { date: "Ferrum · F6 · Power Charge", summary: "F6 logged the same cause code and severity mix today, within the same minute-by-minute windows." },
      ],
      whatChangedSummary: "No control-mode change or operator action logged at onset — both episodes start and stop on their own.",
      whatChanged: [
        { time: "09:14", source: "Control Log", description: "Power Charge remained in AUTO mode throughout; no manual intervention logged.", related: false },
      ],
      confidence: "Repeats an identical pattern twice in one shift",
      confidenceLevel: "high",
      risk: "Cumulative output loss if left unaddressed",
      riskLevel: "medium",
      expectedOutcome: "Recovers fully within minutes each time",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-2",
    severity: "high",
    asset: "Ferrum · F6 · Power Charge",
    line: "Ferrum · F6",
    signal: "Recurring high-severity microstops on Power Charge",
    aiInterpretation: "Matches Ferrum F1's Power Charge pattern almost exactly — same cause code, same timing.",
    since: "15m ago",
    sinceMinutes: 15,
    attentionState: "act",
    detail: {
      signal: "36 microstop events logged on Power Charge today (22 high-severity), in two episodes: 09:14–09:27 and 10:30–10:41.",
      observed: 'Power Charge logged 36 microstop events today, 22 marked high-severity, in the same two windows as Ferrum F1: 09:14–09:27 and 10:30–10:41.',
      derived: "Throughput dropped from ~156 to the low 130s during each window, matching F1's Power Charge shape almost exactly.",
      inferred: "The near-identical timing and magnitude to F1 suggests a shared root cause across both lines — a common part batch or supply issue — rather than two unrelated faults.",
      recommendation: "Investigate alongside F1's Power Charge — a shared root cause (shift-wide supply issue, common part batch) is plausible given the matching timing.",
      evidence: [156.5, 149.6, 142.38, 134.13, 130.54, 132.69, 137.26, 147.17],
      evidencePoints: [
        { time: "09:09", value: "156.5/min", label: "Baseline" },
        { time: "09:12", value: "149.6/min", label: "" },
        { time: "09:15", value: "142.4/min", label: "Episode begins" },
        { time: "09:18", value: "134.1/min", label: "" },
        { time: "09:22", value: "130.5/min", label: "Lowest point" },
        { time: "09:25", value: "132.7/min", label: "" },
        { time: "09:28", value: "137.3/min", label: "Recovering" },
        { time: "09:31", value: "147.2/min", label: "Back to baseline" },
      ],
      relatedOccurrences: [
        { date: "Ferrum · F1 · Power Charge", summary: "F1 logged the same cause code, severity mix, and near-identical timing today." },
      ],
      whatChangedSummary: "No control-mode change logged at onset, same as F1.",
      whatChanged: [
        { time: "09:14", source: "Control Log", description: "Power Charge remained in AUTO mode throughout; no manual intervention logged.", related: false },
      ],
      confidence: "Matches F1's pattern almost exactly",
      confidenceLevel: "high",
      risk: "Cumulative output loss if left unaddressed",
      riskLevel: "medium",
      expectedOutcome: "Recovers fully within minutes each time",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-3",
    severity: "high",
    asset: "Ferrum · F3 · Transfer",
    line: "Ferrum · F3",
    signal: "Transfer blocked, throughput fell to near zero for ~8 minutes",
    aiInterpretation: "Throughput collapsed from 155 to 11 units/min, then recovered within a single minute once the blockage cleared.",
    since: "51m ago",
    sinceMinutes: 51,
    attentionState: "investigate",
    detail: {
      signal: "Transfer station blocking event from 09:56–10:08. Throughput fell from a baseline of about 155 units/min to 11.4 at the low point, while queue and wait time climbed the entire time.",
      observed: 'Transfer logged a blocking event from 09:56–10:08, with 8 of its 12 events marked high-severity.',
      derived: 'Throughput collapsed from ~155 units/min to 11.4 at the low point, then recovered to 155.8 within a single minute once the event ended.',
      inferred: 'The near-instant recovery reads more like a physical blockage clearing than a gradual mechanical degradation.',
      recommendation: "Check Transfer for a jam or blockage that was cleared around 10:08 — confirm what actually cleared it so it can be prevented next time.",
      evidence: [151.93, 100.31, 81.57, 56.27, 39.11, 19.54, 155.81, 151.82],
      evidencePoints: [
        { time: "09:54", value: "151.9/min", label: "Baseline" },
        { time: "09:57", value: "100.3/min", label: "Blocking begins" },
        { time: "09:59", value: "81.6/min", label: "" },
        { time: "10:02", value: "56.3/min", label: "" },
        { time: "10:04", value: "39.1/min", label: "" },
        { time: "10:07", value: "19.5/min", label: "Lowest point" },
        { time: "10:09", value: "155.8/min", label: "Cleared — instant recovery" },
        { time: "10:12", value: "151.8/min", label: "Back to baseline" },
      ],
      relatedOccurrences: [],
      whatChangedSummary: "No logged operator action or control-mode change coincides with either the onset or the clearance.",
      whatChanged: [
        { time: "10:08 → 10:09", source: "Control Log", description: "Throughput recovered in a single minute with no logged manual intervention — likely cleared automatically or by an action not captured in this log.", related: true },
      ],
      confidence: "Clear before/during/after signature",
      confidenceLevel: "high",
      risk: "Near-complete stoppage for 8 minutes",
      riskLevel: "high",
      expectedOutcome: "Fully recovered once cleared",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-4",
    severity: "medium",
    asset: "Ferrum · F4 · Power Charge",
    line: "Ferrum · F4",
    signal: "Medium-severity microstops, single episode",
    aiInterpretation: "One contained episode today, lower severity than F1/F6's Power Charge pattern.",
    since: "35m ago",
    sinceMinutes: 35,
    attentionState: "watch",
    detail: {
      signal: "9 medium-severity microstop events on Power Charge, 10:15–10:24 — a single episode, not yet repeated.",
      observed: 'Power Charge logged 9 medium-severity microstop events in a single window, 10:15–10:24.',
      derived: 'Microstop intensity rose steadily through the window and returned to near-zero within a minute of the last event.',
      inferred: "A single contained episode isn't yet enough to confirm a repeating pattern the way F1 and F6 show — worth monitoring for recurrence before treating it the same way.",
      recommendation: "Monitor for a repeat; a single contained episode doesn't yet justify the same priority as F1/F6.",
      evidence: [6.67, 7.5, 8.41, 8.87, 8.71, 8.96, 0.24, 0.49],
      evidencePoints: [
        { time: "10:09", value: "6.7", label: "Baseline" },
        { time: "10:12", value: "7.5", label: "Episode begins" },
        { time: "10:15", value: "8.4", label: "" },
        { time: "10:18", value: "8.9", label: "" },
        { time: "10:20", value: "8.7", label: "" },
        { time: "10:23", value: "9.0", label: "Highest point" },
        { time: "10:26", value: "0.2", label: "Cleared" },
        { time: "10:29", value: "0.5", label: "Back to baseline" },
      ],
      relatedOccurrences: [
        { date: "Ferrum · F1 & F6 · Power Charge", summary: "Same station type on two other lines had more frequent, higher-severity episodes today." },
      ],
      whatChangedSummary: "No control-mode or setpoint change logged around the episode.",
      whatChanged: [],
      confidence: "Single episode, not yet a confirmed pattern",
      confidenceLevel: "medium",
      risk: "Brief and contained so far",
      riskLevel: "low",
      expectedOutcome: "Cleared on its own within a minute",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-5",
    severity: "medium",
    asset: "Ferrum · F1 · Output",
    line: "Ferrum · F1",
    signal: "Recurring medium-severity microstops on Output",
    aiInterpretation: "Same two-episode shape as Power Charge on this line, but lower severity and no measured throughput impact.",
    since: "17m ago",
    sinceMinutes: 17,
    attentionState: "watch",
    detail: {
      signal: "29 medium-severity microstop events on Output, in two episodes: 09:16–09:29 and 10:28–10:42.",
      observed: 'Output logged 29 medium-severity microstop events, in two windows: 09:16–09:29 and 10:28–10:42.',
      derived: "Timing overlaps closely with the Power Charge episodes on the same line, though Output's own throughput never measurably dropped.",
      inferred: 'This reads as a downstream symptom of the Power Charge issue on F1 rather than an independent fault.',
      recommendation: "Review alongside the Power Charge investigation on F1 rather than as a separate issue.",
      evidence: [4.39, 7.58, 11.42, 13.01, 12.9, 10.34, 6.96, 3.03],
      evidencePoints: [
        { time: "09:12", value: "4.4", label: "Baseline" },
        { time: "09:15", value: "7.6", label: "Episode begins" },
        { time: "09:18", value: "11.4", label: "" },
        { time: "09:21", value: "13.0", label: "Highest point" },
        { time: "09:24", value: "12.9", label: "" },
        { time: "09:27", value: "10.3", label: "" },
        { time: "09:30", value: "7.0", label: "Clearing" },
        { time: "09:33", value: "3.0", label: "Back to baseline" },
      ],
      relatedOccurrences: [
        { date: "Ferrum · F1 · Power Charge", summary: "Same line, overlapping episode timing — worth investigating together." },
        { date: "Ferrum · F6 · Output", summary: "F6's Output logged a nearly identical pattern today (28 events)." },
      ],
      whatChangedSummary: "Nothing logged beyond the microstop events themselves.",
      whatChanged: [],
      confidence: "Recurring, timing matches Power Charge on the same line",
      confidenceLevel: "medium",
      risk: "No measured throughput impact so far",
      riskLevel: "low",
      expectedOutcome: "Clears fully between episodes",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-6",
    severity: "medium",
    asset: "Ferrum · F6 · Shaping",
    line: "Ferrum · F6",
    signal: "Recurring medium-severity microstops on Shaping",
    aiInterpretation: "Matches Ferrum F1's Shaping station pattern; lower severity than the Power Charge issue on this line.",
    since: "20m ago",
    sinceMinutes: 20,
    attentionState: "watch",
    detail: {
      signal: "18 medium-severity microstop events on Shaping today, clustered mainly 09:18–09:25 with a smaller recurrence near 10:30.",
      observed: 'Shaping logged 18 medium-severity microstop events, clustered mainly 09:18–09:25 with a smaller recurrence near 10:30.',
      derived: 'Intensity rises and falls within each cluster with no measurable throughput impact.',
      inferred: "Matches F1's Shaping pattern closely enough to suggest the same underlying cause is present on this station type fleet-wide, not unique to F6.",
      recommendation: "Low priority relative to this line's Power Charge issue — monitor only for now.",
      evidence: [4.68, 7.26, 8.47, 9.45, 7.4, 5.72, 1.55, 0.61],
      evidencePoints: [
        { time: "09:14", value: "4.7", label: "Baseline" },
        { time: "09:17", value: "7.3", label: "Episode begins" },
        { time: "09:20", value: "8.5", label: "" },
        { time: "09:23", value: "9.5", label: "Highest point" },
        { time: "09:27", value: "7.4", label: "" },
        { time: "09:30", value: "5.7", label: "Clearing" },
        { time: "09:33", value: "1.6", label: "" },
        { time: "09:36", value: "0.6", label: "Back to baseline" },
      ],
      relatedOccurrences: [
        { date: "Ferrum · F1 · Shaping", summary: "F1's Shaping logged a nearly identical pattern today (19 events)." },
      ],
      whatChangedSummary: "Nothing logged beyond the microstop events themselves.",
      whatChanged: [],
      confidence: "Recurring, matches a sibling line",
      confidenceLevel: "medium",
      risk: "No measured throughput impact",
      riskLevel: "low",
      expectedOutcome: "Clears fully between clusters",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-7",
    severity: "high",
    asset: "Aurelia · A3 · Buffer",
    line: "Aurelia · A3",
    signal: "Buffer/WIP over 4x every other Aurelia line, still climbing",
    aiInterpretation: "Intake has been running ~121 units/min against Output's ~113 for the entire shift — a small, sustained gap that compounds over time.",
    since: "Ongoing",
    sinceMinutes: 0,
    attentionState: "act",
    detail: {
      signal: "Buffer level on A3 has grown from 60 to over 1,130 units since the start of the shift (09:00–10:59) — every other Aurelia buffer sits between 218 and 242.",
      observed: 'Buffer/WIP on A3 grew from 60 to over 1,130 units across the full shift (09:00–10:59); every sibling Aurelia buffer sits between 218 and 242.',
      derived: "Intake ran ~121 units/min against Output's ~113 for the entire window — a ~7% gap sustained the whole shift.",
      inferred: "The size of the pileup is the cumulative effect of a small persistent rate mismatch, not one triggering event — which is also why 'Other recent' comes up empty for this item.",
      recommendation: "Confirm A3's Output rate against its design target — even a small permanent correction there would stop further growth. This is a growing-WIP risk, not a stopped line.",
      evidence: [60.25, 88.11, 167.01, 319.12, 536.96, 810.22, 1076.98, 1120.58],
      evidencePoints: [
        { time: "09:00", value: "60 units", label: "Baseline — in line with other Aurelia buffers" },
        { time: "09:30", value: "88 units", label: "Still in normal range" },
        { time: "09:40", value: "167 units", label: "Starting to pull away from siblings" },
        { time: "09:50", value: "319 units", label: "" },
        { time: "10:00", value: "537 units", label: "" },
        { time: "10:10", value: "810 units", label: "" },
        { time: "10:20", value: "1,077 units", label: "Now 4x+ every other Aurelia buffer" },
        { time: "10:59", value: "1,137 units", label: "Current — still climbing" },
      ],
      relatedOccurrences: [],
      whatChangedSummary: "No single triggering event — Intake has simply run faster than Output for the entire shift.",
      whatChanged: [
        { time: "09:00–10:59", source: "Rate Comparison", description: "A3 Intake averaged ~121 units/min against Output's ~113 units/min for the full window — a persistent ~7% gap rather than a step change.", related: true },
      ],
      confidence: "Clear, sustained, measurable for the full 2-hour window",
      confidenceLevel: "high",
      risk: "Buffer already 4x+ normal and still rising",
      riskLevel: "high",
      expectedOutcome: "Still climbing as of the latest reading — no sign of leveling off yet",
      outcomeStatus: "none",
    },
  },
  {
    id: "att-8",
    severity: "low",
    asset: "Ferrum · F1 · Transfer",
    line: "Ferrum · F1",
    signal: "Blocking + microstops, medium severity, two episodes",
    aiInterpretation: "Lower priority than this line's Power Charge and Output issues — no high-severity events here today.",
    since: "18m ago",
    sinceMinutes: 18,
    attentionState: "watch",
    detail: {
      signal: "25 medium-severity events on Transfer today (10 blocking, 15 microstop), in two episodes matching this line’s other stations: 09:17–09:28 and 10:29–10:41.",
      observed: "Transfer logged 25 medium-severity events today (10 blocking, 15 microstop), in the same two windows as this line's other stations.",
      derived: 'Every event on this station logged as medium — none reached high severity, unlike Power Charge on the same line.',
      inferred: 'Likely the same underlying F1 issue rippling through Transfer, at lower intensity than Power Charge itself.',
      recommendation: "Fold into the same F1 investigation as Power Charge and Output rather than treating separately.",
      evidence: [40.94, 44.45, 66.22, 100.7, 98.0, 91.91, 28.18, 38.87],
      evidencePoints: [
        { time: "09:16", value: "40.9s", label: "Baseline" },
        { time: "09:18", value: "44.5s", label: "" },
        { time: "09:20", value: "66.2s", label: "" },
        { time: "09:22", value: "100.7s", label: "Highest point" },
        { time: "09:23", value: "98.0s", label: "" },
        { time: "09:25", value: "91.9s", label: "" },
        { time: "09:27", value: "28.2s", label: "Clearing" },
        { time: "09:29", value: "38.9s", label: "Back to baseline" },
      ],
      relatedOccurrences: [
        { date: "Ferrum · F1 · Power Charge & Output", summary: "Same line, same two episode windows — likely one connected issue rather than three separate ones." },
      ],
      whatChangedSummary: "Nothing logged beyond the events themselves.",
      whatChanged: [],
      confidence: "Recurring, matches sibling stations on this line",
      confidenceLevel: "medium",
      risk: "Lowest severity of the issues logged on this line today",
      riskLevel: "low",
      expectedOutcome: "Clears fully between episodes",
      outcomeStatus: "recovering",
    },
  },
  {
    id: "att-9",
    severity: "low",
    asset: "Ferrum · F2",
    line: "Ferrum · F2",
    signal: "Running clean — no events logged today",
    aiInterpretation: "Ferrum lines structurally run lower OEE than Aurelia (different target rate), which is not the same as a flagged issue.",
    since: "This shift",
    sinceMinutes: 119,
    attentionState: "watch",
    detail: {
      signal: "F2 logged zero microstop or blocking events during this window (09:00–10:59) — the cleanest line in the Ferrum refinery today.",
      observed: 'F2 logged zero microstop or blocking events during the full window.',
      derived: "F2's OEE (~0.80) sits below Aurelia's (~0.84–0.91), but every clean Ferrum line shows the same gap.",
      inferred: 'The Ferrum/Aurelia OEE gap reflects a structurally different target rate, not degraded performance — included here only as a clean baseline for comparison.',
      recommendation: "No action needed. Useful as a baseline for comparing the flagged Ferrum lines against.",
      evidence: [0.795, 0.795],
      evidencePoints: [
        { time: "09:00", value: "0.80 OEE", label: "Start of shift" },
        { time: "10:59", value: "0.80 OEE", label: "Current — steady" },
      ],
      relatedOccurrences: [],
      whatChangedSummary: "Nothing changed — included for comparison only.",
      whatChanged: [],
      confidence: "Informational only",
      confidenceLevel: "n/a",
      risk: "None at this time",
      riskLevel: "none",
      expectedOutcome: "—",
      outcomeStatus: "none",
    },
  },
];

const SEVERITY_COLORS = {
  high: '#d64545',
  medium: '#e0a336',
  low: '#8c8c8c',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const SEVERITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

// A second, independent axis from severity — "how bad is this" vs "what's
// my relationship to it right now." Colors deliberately don't reuse
// severity's red/amber/grey, so a card showing both a severity dot and a
// state badge doesn't read as two competing opinions in the same palette.
const ATTENTION_STATE_COLORS = {
  watch: '#6b7a99',
  investigate: '#0078d4',
  act: '#0e8a7d',
  urgent: '#b91c3c',
};
const ATTENTION_STATE_LABELS = {
  watch: 'Watch',
  investigate: 'Investigate',
  act: 'Act',
  urgent: 'Urgent',
};

// ─────────────────────────────────────────────────────────────────────────────
// Attention controls — group-by / sort-by options and the logic behind them
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'severity', label: 'Severity' },
  { value: 'asset', label: 'Asset' },
  { value: 'state', label: 'State' },
];

const SORT_BY_OPTIONS = [
  { value: 'time', label: 'Time' },
  { value: 'severity', label: 'Severity' },
  { value: 'state', label: 'State' },
];

// Most urgent first, mirroring the high-to-low convention severity already uses.
const ATTENTION_STATE_ORDER = { urgent: 0, act: 1, investigate: 2, watch: 3 };

function sortAttentionItems(items, sortBy) {
  const sorted = [...items];
  if (sortBy === 'severity') {
    sorted.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  } else if (sortBy === 'state') {
    sorted.sort((a, b) => ATTENTION_STATE_ORDER[a.attentionState] - ATTENTION_STATE_ORDER[b.attentionState]);
  } else {
    // 'time' — most recent first (smallest elapsed time on top)
    sorted.sort((a, b) => a.sinceMinutes - b.sinceMinutes);
  }
  return sorted;
}

function groupAttentionItems(items, groupBy) {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, items }];
  }
  const buckets = {};
  items.forEach(item => {
    const key = groupBy === 'severity' ? item.severity : groupBy === 'state' ? item.attentionState : item.line;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });
  let keys = Object.keys(buckets);
  if (groupBy === 'severity') {
    keys.sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b]);
  } else if (groupBy === 'state') {
    keys.sort((a, b) => ATTENTION_STATE_ORDER[a] - ATTENTION_STATE_ORDER[b]);
  } else {
    keys.sort((a, b) => a.localeCompare(b));
  }
  return keys.map(key => ({
    key,
    label: groupBy === 'severity' ? SEVERITY_LABELS[key] : groupBy === 'state' ? ATTENTION_STATE_LABELS[key] : key,
    items: buckets[key],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — "Work" items
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_WORK_ITEMS = [
  {
    id: 'wk-1',
    text: 'Inspect breaker CB-204 (Ferrum F2)',
    description: 'Created from Attention: Line down 34 minutes (Ferrum · F2 · Power Charge)',
    source: 'ai',
    done: false,
    createdAt: new Date(Date.now() - 20 * 60000),
  },
  {
    id: 'wk-2',
    text: 'Confirm CIP schedule for F3 tooling review',
    description: '',
    source: 'operator',
    done: false,
    createdAt: new Date(Date.now() - 2 * 3600000),
  },
  {
    id: 'wk-3',
    text: 'Log shift-start walkthrough — Aurelia',
    description: '',
    source: 'operator',
    done: true,
    createdAt: new Date(Date.now() - 5 * 3600000),
  },
];

function formatCreatedAt(date) {
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared bits
// ─────────────────────────────────────────────────────────────────────────────

function AiPill() {
  return <span className="op-ai-pill">AI</span>;
}

// One of two chart-type options for the Evidence card (toggled via a
// ButtonGroup) — a conventional line chart with a visible axis, gridlines,
// and point markers at each reading.
function ComparisonLineChart({ evidence, evidencePoints, color }) {
  const data = evidence.map((v, i) => ({
    time: evidencePoints[i] ? evidencePoints[i].time : String(i),
    value: v,
  }));
  return (
    <div className="op-evidence-chart-wrap">
      <Chart dataSource={data} palette={[color]} height="100%">
        <CommonSeriesSettings argumentField="time" type="line" />
        <Series valueField="value">
          <Point visible={true} size={7} />
        </Series>
        <ArgumentAxis>
          <ChartGrid visible={false} />
        </ArgumentAxis>
        <ValueAxis>
          <ChartGrid visible={true} />
        </ValueAxis>
        <ChartLegend visible={false} />
        <ChartTooltip enabled={true} />
        <ChartExport enabled={false} />
      </Chart>
    </div>
  );
}

// The other chart-type option. Candlestick charts need open/high/low/close
// per point, which this data doesn't actually have (it's one reading per
// minute, not an aggregated period) — so this is a deliberate approximation
// for evaluating the chart type, not a real OHLC series: open is the prior
// reading, close is the current one, and high/low add a small synthetic
// pad around whichever of the two is larger/smaller so the wicks render.
function buildCandlestickData(evidence, evidencePoints) {
  const data = [];
  for (let i = 1; i < evidence.length; i++) {
    const open = evidence[i - 1];
    const close = evidence[i];
    const hi = Math.max(open, close);
    const lo = Math.min(open, close);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.01 || 1;
    data.push({
      time: evidencePoints[i] ? evidencePoints[i].time : String(i),
      open,
      close,
      high: hi + pad,
      low: lo - pad,
    });
  }
  return data;
}

const EVIDENCE_VIEW_ITEMS = [
  { text: 'Line', value: 'line' },
  { text: 'Candlestick', value: 'candlestick' },
  { text: 'Timeline', value: 'timeline' },
  { text: 'Table', value: 'table' },
];

function CandlestickChart({ evidence, evidencePoints, color }) {
  const data = buildCandlestickData(evidence, evidencePoints);
  return (
    <div className="op-evidence-chart-wrap">
      <Chart dataSource={data} palette={[color]} height="100%">
        <Series
          type="candlestick"
          argumentField="time"
          openValueField="open"
          highValueField="high"
          lowValueField="low"
          closeValueField="close"
        />
        <ArgumentAxis>
          <ChartGrid visible={false} />
        </ArgumentAxis>
        <ValueAxis>
          <ChartGrid visible={true} />
        </ValueAxis>
        <ChartLegend visible={false} />
        <ChartTooltip enabled={true} />
        <ChartExport enabled={false} />
      </Chart>
    </div>
  );
}

// Fourth view option — the same evidence readings as a plain table instead
// of a chart or timeline. No fancy grid widget, just rows — this is meant
// to be the plainest possible way to look at the same numbers.
function EvidenceTable({ evidencePoints }) {
  return (
    <table className="op-evidence-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Value</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {evidencePoints.map((p, i) => (
          <tr key={i} className={p.label ? 'op-evidence-table-row--notable' : undefined}>
            <td>{p.time}</td>
            <td>{p.value}</td>
            <td>{p.label || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal tab visuals — Confidence / Risk / Expected outcome as icon+badge
// stat cards instead of a plain text grid, plus a shared vertical timeline
// used for both Evidence readings and What-changed. Built per feedback that
// the Investigate area reads as too much text — this is a first pass, not
// a final design.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_COLORS = { high: '#0078d4', medium: '#5b9bd5', low: '#9db3c9', 'n/a': '#c2c6cc' };
const CONFIDENCE_LABELS = { high: 'High', medium: 'Medium', low: 'Low', 'n/a': 'N/A' };
const CONFIDENCE_BARS = { high: 3, medium: 2, low: 1, 'n/a': 0 };

const RISK_COLORS = { high: '#d64545', medium: '#e0a336', low: '#3fa64c', none: '#9096a3' };
const RISK_LABELS = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

const OUTCOME_COLORS = { recovering: '#3fa64c', none: '#9096a3' };
const OUTCOME_LABELS = { recovering: 'Improving', none: 'N/A' };

function ConfidenceIcon({ filled }) {
  const bar = n => (filled >= n ? 'currentColor' : '#e2e5ea');
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
      <rect x="0" y="11" width="5" height="7" rx="1.2" fill={bar(1)} />
      <rect x="8.5" y="6" width="5" height="12" rx="1.2" fill={bar(2)} />
      <rect x="17" y="0" width="5" height="18" rx="1.2" fill={bar(3)} />
    </svg>
  );
}

function RiskAlertIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 1.5 18.8 16.3H1.2L10 1.5z" />
      <line x1="10" y1="7" x2="10" y2="10.8" />
      <circle cx="10" cy="13.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="18" height="19" viewBox="0 0 18 19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.3 16 3.8v5.1c0 4.4-2.9 7.2-7 8.3-4.1-1.1-7-3.9-7-8.3V3.8L9 1.3z" />
      <path d="M5.8 9.3 8 11.5l4.2-4.6" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,14 7,7.5 11,10.5 19,1.5" />
      <polyline points="13,1.5 19,1.5 19,7.5" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="4" y1="9" x2="14" y2="9" />
    </svg>
  );
}

function VerticalTimeline({ items, maxItems }) {
  let shown = items;
  if (maxItems && items.length > maxItems) {
    // Prioritize highlighted (notable) entries so truncation drops routine
    // readings first — but keep the surviving entries in their original
    // chronological order, since this is a timeline, not a ranked list.
    const indexed = items.map((it, i) => ({ it, i }));
    const highlighted = indexed.filter(x => x.it.highlighted);
    const rest = indexed.filter(x => !x.it.highlighted);
    const keep = [...highlighted, ...rest].slice(0, maxItems);
    keep.sort((a, b) => a.i - b.i);
    shown = keep.map(x => x.it);
  }
  return (
    <div className="op-timeline">
      {shown.map((it, i) => (
        <div key={i} className="op-timeline-row">
          <span
            className={`op-timeline-dot${it.highlighted ? ' op-timeline-dot--highlighted' : ''}`}
            style={it.highlighted ? { background: it.color, boxShadow: `0 0 0 1px ${it.color}` } : undefined}
          />
          <div className="op-timeline-time">{it.time}</div>
          <div className="op-timeline-primary">{it.primary}</div>
          {it.secondary && <div className="op-timeline-secondary">{it.secondary}</div>}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Now — line status strip
// ─────────────────────────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

// Radial "progress ring" gauge — used for Running/Attention lines, where the
// underlying value is genuinely a percent-of-target. Scaled to 120 (not 100)
// since lines can run above target; the ring is colored by line state, the
// center readout stays neutral so it's legible against the dark strip
// regardless of state color.
function PercentGauge({ value, color }) {
  const clamped = Math.max(0, Math.min(value, 120));
  return (
    <div className="op-now-gauge">
      <CircularGauge value={clamped} centerRender={() => (
        <div className="op-now-gauge-center">{value}%</div>
      )}>
        <GaugeSize width={52} height={52} />
        <GaugeMargin top={0} bottom={0} left={0} right={0} />
        <Scale startValue={0} endValue={120} tickInterval={40}>
          <GaugeValueLabel visible={false} />
          <Tick visible={false} />
          <MinorTick visible={false} />
        </Scale>
        <RangeContainer>
          <Range startValue={0} endValue={120} color="rgba(255,255,255,0.12)" />
        </RangeContainer>
        <ValueIndicator type="rangeBar" color={color} />
        <GaugeExport enabled={false} />
        <GaugeTooltip enabled={false} />
      </CircularGauge>
    </div>
  );
}

// Deliberately NOT a gauge — Down/Changeover are durations, not a value
// against a target, so representing them as a percent-style ring would
// imply a denominator we don't actually have.
function DurationIndicator({ minutes, color }) {
  return (
    <div className="op-now-duration">
      <span className="op-now-duration-icon" style={{ color }}><ClockIcon /></span>
      <span className="op-now-duration-value" style={{ color }}>{minutes}</span>
      <span className="op-now-duration-unit">min</span>
    </div>
  );
}

function NowStrip() {
  return (
    <div className="op-now-strip">
      <div className="op-zone-label">Now</div>
      <div className="op-now-tiles">
        {LINE_STATUS.map(line => (
          <div key={line.id} className="op-now-tile">
            <div className="op-now-tile-top">
              <span className="op-now-dot" style={{ background: STATE_COLORS[line.state] }} />
              <span className="op-now-tile-label">{line.label}</span>
            </div>
            <div className="op-now-tile-visual">
              {line.percent !== undefined
                ? <PercentGauge value={line.percent} color={STATE_COLORS[line.state]} />
                : <DurationIndicator minutes={line.elapsedMinutes} color={STATE_COLORS[line.state]} />}
            </div>
            <div className="op-now-tile-state" style={{ color: STATE_COLORS[line.state] }}>
              {STATE_LABELS[line.state]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue map — a plant-wide heatmap of which line/station combinations have a
// real logged issue (from ATTENTION_ITEMS, which is itself sourced from the
// real event log) vs which are clean. First pass at visualizing where issues
// are actually concentrated, per request — this is what makes "Aurelia has
// zero events, Ferrum has several" visible at a glance instead of something
// you have to notice by reading the Attention list closely.
// ─────────────────────────────────────────────────────────────────────────────

const AURELIA_LINES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const AURELIA_STATIONS = ['Intake', 'Stabilization', 'Refinement', 'Inspection', 'Buffer', 'Output'];
const FERRUM_LINES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
const FERRUM_STATIONS = ['Bulk Intake', 'Power Charge', 'Shaping', 'Transfer', 'Output'];

const STATION_ABBR = {
  'Intake': 'Intake', 'Stabilization': 'Stabil.', 'Refinement': 'Refine.',
  'Inspection': 'Inspect.', 'Buffer': 'Buffer', 'Output': 'Output',
  'Bulk Intake': 'Bulk In', 'Power Charge': 'Pwr Chg', 'Shaping': 'Shaping', 'Transfer': 'Transfer',
};

const ISSUEMAP_CLEAN_COLOR = '#3fa66c';
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function buildIssueLookup() {
  const map = {};
  ATTENTION_ITEMS.forEach(item => {
    // asset is "Refinery · Line · Station" for station-level items, or just
    // "Refinery · Line" for line-wide informational items (e.g. att-9) —
    // only the former maps onto a specific heatmap cell.
    const parts = item.asset.split(' · ');
    if (parts.length < 3) return;
    const line = parts[1];
    const station = parts[2];
    const key = `${line}|${station}`;
    const existing = map[key];
    if (!existing || SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]) {
      map[key] = { severity: item.severity, id: item.id, signal: item.signal };
    }
  });
  return map;
}

function IssueMapGrid({ title, lines, stations, lookup, onSelectIssue }) {
  return (
    <div className="op-issuemap-group">
      <div className="op-issuemap-group-title">{title}</div>
      <table className="op-issuemap-table">
        <thead>
          <tr>
            <th></th>
            {stations.map(st => (
              <th key={st} title={st}>{STATION_ABBR[st] || st}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line}>
              <th>{line}</th>
              {stations.map(st => {
                const hit = lookup[`${line}|${st}`];
                const color = hit ? SEVERITY_COLORS[hit.severity] : ISSUEMAP_CLEAN_COLOR;
                return (
                  <td key={st}>
                    <div
                      className={`op-issuemap-cell${hit ? ' op-issuemap-cell--issue' : ''}`}
                      style={{ background: color }}
                      title={hit ? `${line} · ${st}: ${hit.signal}` : `${line} · ${st}: no issues logged`}
                      onClick={hit ? () => onSelectIssue(hit.id) : undefined}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The tab is the bottom 20px of this SAME element, not a separately
// positioned control — collapsed, the element sits translated up almost
// its full height so only that bottom strip (the tab) pokes out below the
// Now strip; clicking slides the whole rigid box down to translateY(0),
// so the tab visibly travels down together with the content, ending up at
// the true bottom of the fully revealed panel. Same idea reversed to close.
function IssueMapOverlay({ expanded, onToggle, onSelectIssue }) {
  return (
    <div className={`op-now-issuemap-overlay${expanded ? ' op-now-issuemap-overlay--open' : ''}`}>
      <div className="op-issuemap-content">
        <IssueMap onSelectIssue={onSelectIssue} />
      </div>
      <button
        className="op-now-pulltab"
        onClick={onToggle}
        title={expanded ? 'Hide issue map' : 'Show issue map'}
      >
        <span className={`op-now-pulltab-chevron${expanded ? ' op-now-pulltab-chevron--open' : ''}`}>▾</span>
      </button>
    </div>
  );
}

function IssueMap({ onSelectIssue }) {
  const lookup = useMemo(buildIssueLookup, []);

  return (
    <div className="op-issuemap-content">
      <div className="op-issuemap-legend">
        <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: ISSUEMAP_CLEAN_COLOR }} />Clean</span>
        <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.low }} />Low</span>
        <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.medium }} />Medium</span>
        <span className="op-issuemap-legend-item"><span className="op-issuemap-legend-dot" style={{ background: SEVERITY_COLORS.high }} />High</span>
      </div>
      <div className="op-issuemap-body">
        <IssueMapGrid title="Aurelia" lines={AURELIA_LINES} stations={AURELIA_STATIONS} lookup={lookup} onSelectIssue={onSelectIssue} />
        <IssueMapGrid title="Ferrum" lines={FERRUM_LINES} stations={FERRUM_STATIONS} lookup={lookup} onSelectIssue={onSelectIssue} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attention — ranked list
// ─────────────────────────────────────────────────────────────────────────────

function AttentionCard({ item, selected, pinned, onSelect, onTogglePin }) {
  return (
    <div
      className={`op-attention-card${selected ? ' op-attention-card--selected' : ''}`}
      onClick={() => onSelect(item.id)}
    >
      <div className="op-attention-card-top">
        <span className="op-severity-dot" style={{ background: SEVERITY_COLORS[item.severity] }} />
        <span className="op-attention-asset">{item.asset}</span>
        <span
          className="op-attention-state-badge"
          style={{ color: ATTENTION_STATE_COLORS[item.attentionState] }}
          title={ATTENTION_STATE_LABELS[item.attentionState]}
        >
          {ATTENTION_STATE_LABELS[item.attentionState]}
        </span>
        <span className="op-attention-since">{item.since}</span>
        <button
          className={`op-pin-btn${pinned ? ' op-pin-btn--active' : ''}`}
          onClick={e => { e.stopPropagation(); onTogglePin(item.id); }}
          title={pinned ? 'Unpin' : 'Pin to top'}
        >
          📌
        </button>
      </div>
      <div className="op-attention-signal">{item.signal}</div>
      <div className="op-attention-interpretation">
        <AiPill />
        <span className="op-attention-interpretation-text">{item.aiInterpretation}</span>
      </div>
      <div className="op-attention-recommendation">
        <AiPill />
        <span className="op-attention-recommendation-text">{item.detail.recommendation}</span>
      </div>
    </div>
  );
}

function AttentionPanel({ selectedId, onSelect }) {
  const [groupBy, setGroupBy] = useState('severity');
  const [sortBy, setSortBy] = useState('time');
  const [pinnedIds, setPinnedIds] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(['low']);

  const togglePin = (id) => {
    setPinnedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleGroupCollapsed = (key) => {
    setCollapsedGroups(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const pinnedItems = useMemo(
    () => sortAttentionItems(ATTENTION_ITEMS.filter(i => pinnedIds.includes(i.id)), sortBy),
    [pinnedIds, sortBy]
  );

  const groupingActive = groupBy !== 'none';
  const pinnedCollapsed = groupingActive && collapsedGroups.includes('pinned');

  const groups = useMemo(() => {
    const unpinned = ATTENTION_ITEMS.filter(i => !pinnedIds.includes(i.id));
    const sorted = sortAttentionItems(unpinned, sortBy);
    return groupAttentionItems(sorted, groupBy);
  }, [groupBy, sortBy, pinnedIds]);

  return (
    <div className="op-panel op-attention-panel">
      <div className="op-zone-label">Attention</div>

      <div className="op-attention-controls">
        <div className="op-control">
          <span className="op-control-label">Group by</span>
          <SelectBox
            dataSource={GROUP_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={groupBy}
            onValueChanged={e => setGroupBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
        <div className="op-control">
          <span className="op-control-label">Sort by</span>
          <SelectBox
            dataSource={SORT_BY_OPTIONS}
            valueExpr="value"
            displayExpr="label"
            value={sortBy}
            onValueChanged={e => setSortBy(e.value)}
            stylingMode="outlined"
            width={110}
            height={24}
          />
        </div>
      </div>

      <div className="op-attention-list">
        {pinnedItems.length > 0 && (
          <div>
            <div
              className={`op-attention-group-header op-attention-group-header--pinned${groupingActive ? ' op-attention-group-header--clickable' : ''}`}
              onClick={groupingActive ? () => toggleGroupCollapsed('pinned') : undefined}
            >
              {groupingActive && (
                <span className={`op-group-chevron${pinnedCollapsed ? ' op-group-chevron--collapsed' : ''}`}>▾</span>
              )}
              <span className="op-pin-icon">📌</span>
              Pinned
              <span className="op-group-count-badge">{pinnedItems.length}</span>
            </div>
            {!pinnedCollapsed && pinnedItems.map(item => (
              <AttentionCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                pinned={true}
                onSelect={onSelect}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}

        {groups.map(group => {
          const collapsed = group.label && collapsedGroups.includes(group.key);
          return (
            <div key={group.key}>
              {group.label && (
                <div
                  className="op-attention-group-header op-attention-group-header--clickable"
                  onClick={() => toggleGroupCollapsed(group.key)}
                >
                  <span className={`op-group-chevron${collapsed ? ' op-group-chevron--collapsed' : ''}`}>▾</span>
                  {group.label}
                  <span className="op-group-count-badge">{group.items.length}</span>
                </div>
              )}
              {!collapsed && group.items.map(item => (
                <AttentionCard
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  pinned={false}
                  onSelect={onSelect}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work list — same panel slot as Attention, shown when the nav rail is in
// Work mode. Deliberately mirrors AttentionPanel's card-list shape (no
// group/sort controls yet — tasks don't have severity/asset to group by).
// ─────────────────────────────────────────────────────────────────────────────

function WorkListPanel({ items, selectedId, onSelect, onToggleDone, onAdd }) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <div className="op-panel op-attention-panel">
      <div className="op-zone-label">Work</div>
      <div className="op-work-list">
        {items.map(w => (
          <div
            key={w.id}
            className={`op-work-item${w.done ? ' op-work-item--done' : ''}${selectedId === w.id ? ' op-work-item--selected' : ''}`}
            onClick={() => onSelect(w.id)}
          >
            <input
              type="checkbox"
              checked={w.done}
              onClick={e => e.stopPropagation()}
              onChange={() => onToggleDone(w.id)}
            />
            <span className="op-work-text">{w.text}</span>
            {w.source === 'ai' && <AiPill />}
          </div>
        ))}
      </div>
      <div className="op-work-add">
        <input
          type="text"
          placeholder="Add a task…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <button className="op-btn op-btn--secondary" onClick={submit}>Add</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Investigate — detail for the selected Attention item
// ─────────────────────────────────────────────────────────────────────────────

function InvestigatePanel({ item, onCreateWorkItem }) {
  const [evidenceView, setEvidenceView] = useState('line');

  if (!item) {
    return (
      <div className="op-panel op-investigate-panel">
        <div className="op-zone-label">Investigate</div>
        <div className="op-investigate-empty">Select an item in Attention to see the full picture.</div>
      </div>
    );
  }

  const d = item.detail;
  const severityColor = SEVERITY_COLORS[item.severity];

  return (
    <div className="op-panel op-investigate-panel">
      <div className="op-zone-label">Investigate</div>

      <div className="op-investigate-header">
        <span className="op-severity-dot" style={{ background: severityColor }} />
        <div>
          <div className="op-investigate-asset">{item.asset}</div>
          <div className="op-investigate-signal">{item.signal}</div>
        </div>
      </div>

      <div className="op-investigate-toprow">
        <div className="op-dash-ministat-row">
          <div className="op-dash-ministat" style={{ color: CONFIDENCE_COLORS[d.confidenceLevel] }} title={d.confidence}>
            <ConfidenceIcon filled={CONFIDENCE_BARS[d.confidenceLevel]} />
            <span>{CONFIDENCE_LABELS[d.confidenceLevel]}</span>
          </div>
          <div className="op-dash-ministat" style={{ color: RISK_COLORS[d.riskLevel] }} title={d.risk}>
            {d.riskLevel === 'none' ? <ShieldCheckIcon /> : <RiskAlertIcon />}
            <span>{RISK_LABELS[d.riskLevel]}</span>
          </div>
          <div className="op-dash-ministat" style={{ color: OUTCOME_COLORS[d.outcomeStatus] }} title={d.expectedOutcome !== '—' ? d.expectedOutcome : 'No outcome defined'}>
            {d.outcomeStatus === 'recovering' ? <TrendUpIcon /> : <DashIcon />}
            <span>{OUTCOME_LABELS[d.outcomeStatus]}</span>
          </div>
        </div>
        <button className="op-btn op-btn--primary" onClick={() => onCreateWorkItem(item)}>
          Create work item
        </button>
      </div>

      <div className="op-investigate-dashboard">
        <div className="op-dashboard-card op-dashboard-card--signal">
          <div className="op-dashboard-card-title">Signal</div>
          <div className="op-dash-text op-dash-text--clamp3">{d.signal}</div>
          <div className="op-dash-separator" />
          <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
            <ButtonGroup
              items={EVIDENCE_VIEW_ITEMS}
              keyExpr="value"
              selectedItemKeys={[evidenceView]}
              onItemClick={e => setEvidenceView(e.itemData.value)}
              stylingMode="outlined"
              className="op-dash-chart-toggle"
            />
            {evidenceView === 'line' && (
              <ComparisonLineChart evidence={d.evidence} evidencePoints={d.evidencePoints} color={severityColor} />
            )}
            {evidenceView === 'candlestick' && (
              <CandlestickChart evidence={d.evidence} evidencePoints={d.evidencePoints} color={severityColor} />
            )}
            {evidenceView === 'timeline' && (
              <VerticalTimeline
                maxItems={4}
                items={d.evidencePoints.map(p => ({
                  time: p.time,
                  primary: p.value,
                  secondary: p.label || null,
                  highlighted: !!p.label,
                  color: severityColor,
                }))}
              />
            )}
            {evidenceView === 'table' && (
              <EvidenceTable evidencePoints={d.evidencePoints} />
            )}
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--interpretation">
          <div className="op-dashboard-card-title">Interpretation</div>
          <div className="op-dashboard-card-body op-dashboard-card-body--scrollable">
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--observed">Observed</span>
              <div className="op-dash-text op-dash-text--clamp2">{d.observed}</div>
            </div>
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--derived">Derived</span>
              <div className="op-dash-text op-dash-text--clamp2">{d.derived}</div>
            </div>
            <div className="op-evidence-layer">
              <span className="op-evidence-layer-label op-evidence-layer-label--inferred"><AiPill />Inferred</span>
              <div className="op-dash-text op-dash-text--clamp2">{d.inferred}</div>
            </div>
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--similar">
          <div className="op-dashboard-card-title"><AiPill />Similar</div>
          <div className="op-dashboard-card-body">
            {d.relatedOccurrences.length > 0 ? (
              d.relatedOccurrences.map((occ, i) => (
                <div key={i} className="op-dash-text op-dash-text--clamp2">{occ.summary}</div>
              ))
            ) : (
              <div className="op-dash-text op-dash-text--muted">No matching pattern found.</div>
            )}
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--otherrecent">
          <div className="op-dashboard-card-title"><AiPill />Other recent</div>
          <div className="op-dashboard-card-body">
            <div className="op-dash-text op-dash-text--clamp2">{d.whatChangedSummary}</div>
            <VerticalTimeline
              maxItems={2}
              items={d.whatChanged.map(c => ({
                time: c.time,
                primary: c.description,
                secondary: c.source,
                highlighted: c.related,
                color: '#0078d4',
              }))}
            />
          </div>
        </div>

        <div className="op-dashboard-card op-dashboard-card--nextsteps">
          <div className="op-dashboard-card-title"><AiPill />Next steps</div>
          <div className="op-dashboard-card-body">
            <div className="op-dash-text op-dash-text--clamp3">{d.recommendation}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task detail — same panel slot as Investigate, shown when the nav rail is
// in Work mode. Deliberately minimal for now: name, description, created
// datetime, done status — can grow into something richer later.
// ─────────────────────────────────────────────────────────────────────────────

function TaskDetailPanel({ item, onToggleDone }) {
  if (!item) {
    return (
      <div className="op-panel op-investigate-panel">
        <div className="op-zone-label">Investigate</div>
        <div className="op-investigate-empty">Select a task to see its details.</div>
      </div>
    );
  }

  return (
    <div className="op-panel op-investigate-panel">
      <div className="op-zone-label">Investigate</div>

      <div className="op-investigate-header">
        <div>
          <div className="op-investigate-asset">{item.source === 'ai' ? 'AI-created task' : 'Task'}</div>
          <div className="op-investigate-signal">{item.text}</div>
        </div>
      </div>

      <div className="op-investigate-chain">
        <div className="op-chain-row">
          <div className="op-chain-label">Description</div>
          <div className="op-chain-value">{item.description || 'No additional description.'}</div>
        </div>
        <div className="op-chain-row">
          <div className="op-chain-label">Created</div>
          <div className="op-chain-value">{formatCreatedAt(item.createdAt)}</div>
        </div>
        <div className="op-chain-row">
          <div className="op-chain-label">Status</div>
          <div className="op-chain-value">{item.done ? 'Done' : 'Not done'}</div>
        </div>
      </div>

      <div className="op-investigate-actions">
        <button className="op-btn op-btn--primary" onClick={() => onToggleDone(item.id)}>
          {item.done ? 'Mark as not done' : 'Mark as done'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-panel tab icons — Work / Chat / AI, icon-only (title attr for a11y)
// ─────────────────────────────────────────────────────────────────────────────

function WorkTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
      <rect x="6" y="1" width="4" height="2" rx="0.6" />
      <line x1="5.5" y1="7" x2="10.5" y2="7" />
      <line x1="5.5" y1="9.5" x2="10.5" y2="9.5" />
      <line x1="5.5" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ChatTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6.7l-2.9 2.35a.4.4 0 0 1-.65-.31V11.5h-.65a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function AiTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M8 1.4c.35 3 1.15 4.8 4.1 5.1-2.95.3-3.75 2.1-4.1 5.1-.35-3-1.15-4.8-4.1-5.1 2.95-.3 3.75-2.1 4.1-5.1z" />
      <path d="M13 9.6c.15 1.1.5 1.5 1.5 1.7-1 .2-1.35.6-1.5 1.7-.15-1.1-.5-1.5-1.5-1.7 1-.2 1.35-.6 1.5-1.7z" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — Chat (contacts)
// ─────────────────────────────────────────────────────────────────────────────

function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

const CONTACTS_SEED = [
  {
    id: 'c1',
    name: 'Jordan Blake',
    role: 'Shift Lead',
    unread: true,
    thread: [
      { from: 'them', text: 'Can you check on F2 before you head to break?', time: '2:14 PM' },
    ],
  },
  {
    id: 'c2',
    name: 'Priya Nair',
    role: 'Maintenance',
    unread: true,
    thread: [
      { from: 'them', text: 'Heading over to inspect CB-204 now.', time: '2:01 PM' },
      { from: 'them', text: 'Should have an update in about 15.', time: '2:02 PM' },
    ],
  },
  {
    id: 'c3',
    name: 'Sam Ortiz',
    role: 'Quality',
    unread: false,
    thread: [
      { from: 'me', text: 'Logged the reject-rate note for A1.', time: '1:10 PM' },
      { from: 'them', text: 'Thanks, got it — flagged the lot too.', time: '1:12 PM' },
    ],
  },
  {
    id: 'c4',
    name: 'Night Shift Lead',
    role: 'Shift Lead',
    unread: false,
    thread: [
      { from: 'them', text: 'Handoff notes are in the log — nothing major overnight.', time: '6:02 AM' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — AI chat
// ─────────────────────────────────────────────────────────────────────────────

const AI_CHAT_INITIAL = [
  { from: 'ai', text: 'Hi — I can help you look into anything on the floor right now. What do you need?' },
];

const AI_CHAT_CANNED_REPLIES = [
  "Let me pull that up — one moment.",
  "I don't have a confident read on that yet, but I'll keep watching it.",
  "Noted — I'll flag it if the pattern continues.",
  "Nothing else correlates with that in the current readings.",
];

// Suggested-prompt chips — teaches what's possible and removes the
// prompt-writing burden, rather than a blank chat box. Generic for now
// (not yet tied to whichever Attention item is selected); a natural
// follow-up is making this context-aware.
const AI_CHAT_SUGGESTED_PROMPTS = [
  'Why was this flagged?',
  'What changed first?',
  'Similar events',
  'What should I check?',
  'What happens if I wait?',
];

// ─────────────────────────────────────────────────────────────────────────────
// Side panel content — Chat / AI, now driven by the RightRail below rather
// than an internal tab bar
// ─────────────────────────────────────────────────────────────────────────────

function ContactsPanel({ contacts, activeContactId, onSelectContact, onBack, onSendMessage }) {
  const [draft, setDraft] = useState('');
  const activeContact = contacts.find(c => c.id === activeContactId) || null;

  const send = () => {
    const text = draft.trim();
    if (!text || !activeContact) return;
    onSendMessage(activeContact.id, text);
    setDraft('');
  };

  if (!activeContact) {
    return (
      <div className="op-chat-list">
        {contacts.map(c => {
          const lastMessage = c.thread[c.thread.length - 1];
          return (
            <div key={c.id} className="op-contact-row" onClick={() => onSelectContact(c.id)}>
              <div className="op-contact-avatar">{initials(c.name)}</div>
              <div className="op-contact-info">
                <div className="op-contact-name-row">
                  <span className="op-contact-name">{c.name}</span>
                  {c.unread && <span className="op-unread-dot" />}
                </div>
                <div className="op-contact-role">{c.role}</div>
                {lastMessage && <div className="op-contact-preview">{lastMessage.text}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="op-chat-thread">
      <div className="op-chat-thread-header" onClick={onBack}>
        <span className="op-chat-back">←</span>
        <span className="op-contact-name">{activeContact.name}</span>
      </div>
      <div className="op-chat-messages">
        {activeContact.thread.map((m, i) => (
          <div key={i} className={`op-chat-bubble op-chat-bubble--${m.from}`}>
            <div className="op-chat-bubble-text">{m.text}</div>
            <div className="op-chat-bubble-time">{m.time}</div>
          </div>
        ))}
      </div>
      <div className="op-chat-input-row">
        <input
          type="text"
          placeholder={`Message ${activeContact.name.split(' ')[0]}…`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
        />
        <button className="op-btn op-btn--secondary" onClick={send}>Send</button>
      </div>
    </div>
  );
}

function AiChatPanel() {
  const [messages, setMessages] = useState(AI_CHAT_INITIAL);
  const [draft, setDraft] = useState('');
  const timeoutRef = useRef(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const send = (overrideText) => {
    const text = (overrideText !== undefined ? overrideText : draft).trim();
    if (!text) return;
    setMessages(prev => [...prev, { from: 'user', text }]);
    setDraft('');
    timeoutRef.current = setTimeout(() => {
      const reply = AI_CHAT_CANNED_REPLIES[Math.floor(Math.random() * AI_CHAT_CANNED_REPLIES.length)];
      setMessages(prev => [...prev, { from: 'ai', text: reply }]);
    }, 700);
  };

  return (
    <>
      <div className="op-ai-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`op-ai-chat-bubble op-ai-chat-bubble--${m.from}`}>
            {m.from === 'ai' && <AiPill />}
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      <div className="op-ai-chat-prompts">
        {AI_CHAT_SUGGESTED_PROMPTS.map(prompt => (
          <button key={prompt} className="op-ai-chat-prompt-chip" onClick={() => send(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="op-ai-chat-input-row">
        <input
          type="text"
          placeholder="Ask the AI…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
        />
        <button className="op-btn op-btn--primary" onClick={() => send()}>Send</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nav rail — Gmail-style collapsible rail (icon+label+count expanded,
// icon+dot collapsed), sitting as its own element alongside the existing
// Attention panel and Work/Chat/AI tabs — not a replacement for either.
// "New" is derived from data already on hand rather than separate state:
//   - Attention: items that surfaced within the last 15 minutes
//   - Work: not-yet-done items the AI created (source: 'ai')
// ─────────────────────────────────────────────────────────────────────────────

const NEW_ATTENTION_THRESHOLD_MINUTES = 15;

function AttentionRailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.8c-2 0-3.4 1.6-3.4 3.6v2.1c0 .5-.2 1-.6 1.4L3 9.9c-.5.5-.1 1.3.6 1.3h9c.7 0 1.1-.8.6-1.3l-1-1c-.4-.4-.6-.9-.6-1.4V5.4c0-2-1.4-3.6-3.4-3.6z" />
      <path d="M6.3 12.3a1.7 1.7 0 0 0 3.4 0" />
    </svg>
  );
}

function NavRail({ mode, hidden, onIconClick, attentionCount, workCount }) {
  const [expanded, setExpanded] = useState(false);

  const items = [
    { id: 'attention', label: 'Attention', Icon: AttentionRailIcon, count: attentionCount },
    { id: 'work', label: 'Work', Icon: WorkTabIcon, count: workCount },
  ];

  return (
    <div className={`op-nav-rail${expanded ? ' op-nav-rail--expanded' : ''}`}>
      <button
        className="op-nav-rail-toggle"
        onClick={() => setExpanded(e => !e)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? '‹' : '›'}
      </button>

      {items.map(item => {
        const isActive = mode === item.id && !hidden;
        return (
          <button
            key={item.id}
            className={`op-nav-rail-item${isActive ? ' op-nav-rail-item--active' : ''}`}
            onClick={() => onIconClick(item.id)}
            title={mode === item.id ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`) : item.label}
          >
            <span className="op-nav-rail-icon">
              <item.Icon />
              {!expanded && item.count > 0 && <span className="op-nav-rail-dot" />}
            </span>
            {expanded && <span className="op-nav-rail-label">{item.label}</span>}
            {expanded && item.count > 0 && <span className="op-nav-rail-count">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}


function SidePanel({ mode, contacts, activeContactId, onSelectContact, onBack, onSendMessage }) {
  return (
    <div className="op-panel op-side-panel">
      <div className="op-side-tab-content">
        {mode === 'chat' && (
          <ContactsPanel
            contacts={contacts}
            activeContactId={activeContactId}
            onSelectContact={onSelectContact}
            onBack={onBack}
            onSendMessage={onSendMessage}
          />
        )}
        {mode === 'ai' && <AiChatPanel />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right rail — mirrors NavRail's look, but always icon-only (no expand/
// collapse — per request, this one never needs a label view) and switches
// the right panel between Chat and AI. Room to add more icons later for
// other right-panel content, same pattern as the left rail's items array.
// ─────────────────────────────────────────────────────────────────────────────

const RIGHT_RAIL_ITEMS = [
  { id: 'chat', label: 'Chat', Icon: ChatTabIcon },
  { id: 'ai', label: 'AI chat', Icon: AiTabIcon },
];

function RightRail({ mode, hidden, onIconClick, hasUnread }) {
  return (
    <div className="op-nav-rail op-nav-rail--right">
      {RIGHT_RAIL_ITEMS.map(item => {
        const isActive = mode === item.id && !hidden;
        return (
          <button
            key={item.id}
            className={`op-nav-rail-item${isActive ? ' op-nav-rail-item--active' : ''}`}
            onClick={() => onIconClick(item.id)}
            title={mode === item.id ? (hidden ? `Show ${item.label}` : `Hide ${item.label}`) : item.label}
          >
            <span className="op-nav-rail-icon">
              <item.Icon />
              {item.id === 'chat' && hasUnread && <span className="op-nav-rail-dot" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main workspace
// ─────────────────────────────────────────────────────────────────────────────

export default function OperatorWorkspace() {
  const [railMode, setRailMode] = useState('attention'); // 'attention' | 'work' — drives both the list and detail slots
  const [leftPanelHidden, setLeftPanelHidden] = useState(true);
  const [issueMapExpanded, setIssueMapExpanded] = useState(false);
  const [selectedAttentionId, setSelectedAttentionId] = useState(ATTENTION_ITEMS[0].id);
  const [workItems, setWorkItems] = useState(INITIAL_WORK_ITEMS);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(INITIAL_WORK_ITEMS[0].id);

  const [rightPanelMode, setRightPanelMode] = useState('chat'); // 'chat' | 'ai' — drives the right rail + right panel
  const [rightPanelHidden, setRightPanelHidden] = useState(true);
  const [contacts, setContacts] = useState(CONTACTS_SEED);
  const [activeContactId, setActiveContactId] = useState(null);

  const selectedItem = ATTENTION_ITEMS.find(i => i.id === selectedAttentionId) || null;
  const selectedWorkItem = workItems.find(w => w.id === selectedWorkItemId) || null;
  const hasUnreadContacts = contacts.some(c => c.unread);

  // Clicking the icon for the mode that's already showing hides that panel;
  // clicking it again (or clicking a different icon) brings it back.
  const handleLeftIconClick = (id) => {
    if (railMode === id && !leftPanelHidden) {
      setLeftPanelHidden(true);
    } else {
      setRailMode(id);
      setLeftPanelHidden(false);
    }
  };

  const handleRightIconClick = (id) => {
    if (rightPanelMode === id && !rightPanelHidden) {
      setRightPanelHidden(true);
    } else {
      setRightPanelMode(id);
      setRightPanelHidden(false);
    }
  };

  const selectContact = (id) => {
    setActiveContactId(id);
    setContacts(prev => prev.map(c => (c.id === id ? { ...c, unread: false } : c)));
  };

  const sendContactMessage = (contactId, text) => {
    setContacts(prev => prev.map(c => (
      c.id === contactId
        ? { ...c, thread: [...c.thread, { from: 'me', text, time: 'Now' }] }
        : c
    )));
  };

  const newAttentionItems = useMemo(
    () => ATTENTION_ITEMS
      .filter(i => i.sinceMinutes <= NEW_ATTENTION_THRESHOLD_MINUTES)
      .sort((a, b) => a.sinceMinutes - b.sinceMinutes),
    []
  );
  const newWorkItems = useMemo(
    () => workItems.filter(w => w.source === 'ai' && !w.done),
    [workItems]
  );

  const handleCreateWorkItem = (attentionItem) => {
    setWorkItems(prev => [
      {
        id: `wk-${Date.now()}`,
        text: attentionItem.detail.recommendation,
        description: `Created from Attention: ${attentionItem.signal} (${attentionItem.asset})`,
        source: 'ai',
        done: false,
        createdAt: new Date(),
      },
      ...prev,
    ]);
  };

  const handleToggleWorkItem = (id) => {
    setWorkItems(prev => prev.map(w => (w.id === id ? { ...w, done: !w.done } : w)));
  };

  const handleAddWorkItem = (text) => {
    const id = `wk-${Date.now()}`;
    setWorkItems(prev => [{ id, text, description: '', source: 'operator', done: false, createdAt: new Date() }, ...prev]);
    setSelectedWorkItemId(id);
  };

  const handleSelectIssueFromMap = (attentionId) => {
    setRailMode('attention');
    setSelectedAttentionId(attentionId);
  };

  // Set to true to bring back the "Operator Interface" title banner —
  // hidden for now per request, left in place rather than deleted.
  const SHOW_WORKSPACE_BANNER = false;

  return (
    <div className="op-workspace">
      {SHOW_WORKSPACE_BANNER && (
        <div className="op-workspace-banner">
          <span className="op-workspace-title">Operator Interface</span>
          <span className="op-workspace-badge">Concept shell · mock data</span>
        </div>
      )}

      <div className="op-now-section">
        <NowStrip />
        <IssueMapOverlay
          expanded={issueMapExpanded}
          onToggle={() => setIssueMapExpanded(e => !e)}
          onSelectIssue={handleSelectIssueFromMap}
        />
      </div>

      <div className="op-main-row">
        <NavRail
          mode={railMode}
          hidden={leftPanelHidden}
          onIconClick={handleLeftIconClick}
          attentionCount={newAttentionItems.length}
          workCount={newWorkItems.length}
        />

        <Splitter orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
          {!leftPanelHidden && (
            <SplitterItem size="320px" minSize="240px" resizable={true}>
              {railMode === 'attention' ? (
                <AttentionPanel selectedId={selectedAttentionId} onSelect={setSelectedAttentionId} />
              ) : (
                <WorkListPanel
                  items={workItems}
                  selectedId={selectedWorkItemId}
                  onSelect={setSelectedWorkItemId}
                  onToggleDone={handleToggleWorkItem}
                  onAdd={handleAddWorkItem}
                />
              )}
            </SplitterItem>
          )}
          <SplitterItem resizable={true}>
            {railMode === 'attention' ? (
              <InvestigatePanel key={selectedAttentionId} item={selectedItem} onCreateWorkItem={handleCreateWorkItem} />
            ) : (
              <TaskDetailPanel key={selectedWorkItemId} item={selectedWorkItem} onToggleDone={handleToggleWorkItem} />
            )}
          </SplitterItem>
          {!rightPanelHidden && (
            <SplitterItem size="280px" minSize="240px" resizable={true}>
              <SidePanel
                mode={rightPanelMode}
                contacts={contacts}
                activeContactId={activeContactId}
                onSelectContact={selectContact}
                onBack={() => setActiveContactId(null)}
                onSendMessage={sendContactMessage}
              />
            </SplitterItem>
          )}
        </Splitter>

        <RightRail mode={rightPanelMode} hidden={rightPanelHidden} onIconClick={handleRightIconClick} hasUnread={hasUnreadContacts} />
      </div>
    </div>
  );
}
