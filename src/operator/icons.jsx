// operator/icons.jsx
// Every small inline-SVG icon the Operator/Configurator interface uses —
// toolbar buttons, rail items, evidence badges — plus IconButtonGroupItem,
// which renders one of them inside a DevExtreme ButtonGroup. 16px,
// currentColor strokes, so they take the button's text color.

// Flow-control button group icons — 16px, currentColor stroke, like every
// other icon in this file, so they pick up the button's active/inactive
// text color automatically.
export function ColumnFlowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="3" y1="4" x2="13" y2="4" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="3" y1="12" x2="13" y2="12" />
    </svg>
  );
}

export function RowFlowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="4" y1="3" x2="4" y2="13" />
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="12" y1="3" x2="12" y2="13" />
    </svg>
  );
}

export function WrapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h7a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H6" />
      <path d="M8.5 6.5 6 9l2.5 2.5" />
    </svg>
  );
}

export function NoWrapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="8" x2="11" y2="8" />
      <path d="M8.5 5.5 11 8l-2.5 2.5" />
      <line x1="14" y1="4" x2="14" y2="12" />
    </svg>
  );
}

export function DistributeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="3" x2="2" y2="13" />
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="14" y1="3" x2="14" y2="13" />
    </svg>
  );
}

export function ClusterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="3" y1="3" x2="3" y2="13" />
      <line x1="6" y1="3" x2="6" y2="13" />
      <line x1="9" y1="3" x2="9" y2="13" />
    </svg>
  );
}

// Diagram algorithm icons — nodes as small filled circles, edges as thin
// lines, each shape suggesting the algorithm's characteristic structure
// (layered = rows connected top-to-bottom, tree = a branching hierarchy,
// radial = a hub-and-spoke ring, force = an irregular organic cluster
// with no clear center or hierarchy, unlike the other three).
export function LayeredAlgorithmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="5" y1="3" x2="5" y2="8" />
      <line x1="11" y1="3" x2="11" y2="8" />
      <line x1="5" y1="8" x2="5" y2="13" />
      <line x1="11" y1="8" x2="11" y2="13" />
      <circle cx="5" cy="3" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="11" cy="3" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="5" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="11" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="5" cy="13" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="11" cy="13" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TreeAlgorithmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="8" y1="3" x2="3" y2="9" />
      <line x1="8" y1="3" x2="8" y2="9" />
      <line x1="8" y1="3" x2="13" y2="9" />
      <circle cx="8" cy="3" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="3" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RadialAlgorithmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="8" y1="8" x2="8" y2="2.5" />
      <line x1="8" y1="8" x2="13" y2="5.5" />
      <line x1="8" y1="8" x2="13" y2="10.5" />
      <line x1="8" y1="8" x2="8" y2="13.5" />
      <line x1="8" y1="8" x2="3" y2="10.5" />
      <line x1="8" y1="8" x2="3" y2="5.5" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="2.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ForceAlgorithmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="2.5" y1="5" x2="7" y2="3" />
      <line x1="7" y1="3" x2="11.5" y2="5.5" />
      <line x1="2.5" y1="5" x2="6" y2="10" />
      <line x1="11.5" y1="5.5" x2="13" y2="11" />
      <line x1="6" y1="10" x2="9.5" y2="13" />
      <line x1="13" y1="11" x2="9.5" y2="13" />
      <line x1="6" y1="10" x2="11.5" y2="5.5" />
      <circle cx="2.5" cy="5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="6" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CardsLayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1" y="4" width="4" height="8" rx="0.5" />
      <rect x="6" y="4" width="4" height="8" rx="0.5" />
      <rect x="11" y="4" width="4" height="8" rx="0.5" />
    </svg>
  );
}

export function DiagramLayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1" y="6" width="4" height="4" rx="0.5" />
      <rect x="11" y="6" width="4" height="4" rx="0.5" />
      <line x1="5" y1="8" x2="11" y2="8" />
    </svg>
  );
}

export function OrthogonalRoutingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <polyline points="2,4 9,4 9,12 14,12" />
    </svg>
  );
}

export function PolylineRoutingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <polyline points="2,4 7,10 14,4" />
    </svg>
  );
}

export function AlignTopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="2" x2="15" y2="2" />
      <rect x="3" y="4" width="3" height="5" />
      <rect x="7" y="4" width="3" height="9" />
      <rect x="11" y="4" width="3" height="3" />
    </svg>
  );
}

export function AlignMiddleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="8" x2="15" y2="8" strokeDasharray="2,2" />
      <rect x="3" y="5.5" width="3" height="5" />
      <rect x="7" y="3.5" width="3" height="9" />
      <rect x="11" y="6.5" width="3" height="3" />
    </svg>
  );
}

export function AlignBottomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="14" x2="15" y2="14" />
      <rect x="3" y="7" width="3" height="5" />
      <rect x="7" y="3" width="3" height="9" />
      <rect x="11" y="9" width="3" height="3" />
    </svg>
  );
}

export function AlignLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="1" x2="2" y2="15" />
      <rect x="4" y="3" width="5" height="3" />
      <rect x="4" y="7" width="9" height="3" />
      <rect x="4" y="11" width="3" height="3" />
    </svg>
  );
}

export function AlignCenterHIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="8" y1="1" x2="8" y2="15" strokeDasharray="2,2" />
      <rect x="5.5" y="3" width="5" height="3" />
      <rect x="3.5" y="7" width="9" height="3" />
      <rect x="6.5" y="11" width="3" height="3" />
    </svg>
  );
}

export function AlignRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="14" y1="1" x2="14" y2="15" />
      <rect x="7" y="3" width="5" height="3" />
      <rect x="3" y="7" width="9" height="3" />
      <rect x="9" y="11" width="3" height="3" />
    </svg>
  );
}

export function DistributeHorizontalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1" y="4" width="3" height="8" />
      <rect x="6.5" y="4" width="3" height="8" />
      <rect x="12" y="4" width="3" height="8" />
      <line x1="4" y1="8" x2="6.5" y2="8" strokeDasharray="1,1.5" />
      <line x1="9.5" y1="8" x2="12" y2="8" strokeDasharray="1,1.5" />
    </svg>
  );
}

export function DistributeVerticalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="4" y="1" width="8" height="3" />
      <rect x="4" y="6.5" width="8" height="3" />
      <rect x="4" y="12" width="8" height="3" />
      <line x1="8" y1="4" x2="8" y2="6.5" strokeDasharray="1,1.5" />
      <line x1="8" y1="9.5" x2="8" y2="12" strokeDasharray="1,1.5" />
    </svg>
  );
}

export function ArrowOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="8" x2="11" y2="8" />
      <polyline points="8,4 13,8 8,12" />
    </svg>
  );
}

export function ArrowOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
}

export function LabelOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="12" x2="15" y2="12" />
      <path d="M5 3 H10 L13 6 L10 9 H5 Z" />
      <circle cx="7" cy="6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LabelOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="8" x2="15" y2="8" />
    </svg>
  );
}

export function ConnectionAnywhereIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="7" y="3" width="8" height="10" rx="0.5" />
      <line x1="1" y1="14" x2="7" y2="9" />
    </svg>
  );
}

export function ConnectionCenterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="7" y="3" width="8" height="10" rx="0.5" />
      <line x1="1" y1="8" x2="7" y2="8" />
    </svg>
  );
}

// Filled circle = always, half-filled = sometimes — same family as
// VisibilityStateIcon below, kept as separate small icons here since this
// filter's third state ("All", show everything) is a different concept
// from that component's third state ("Never") and needs a visually
// distinct icon rather than reusing the plain outline circle.
export function AlwaysFilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="8" cy="8" r="6" fill="currentColor" />
    </svg>
  );
}

export function SometimesFilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AllFilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <circle cx="5.5" cy="6" r="3.2" fillOpacity="0.35" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="6" r="3.2" fillOpacity="0.35" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="3.2" fillOpacity="0.35" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Shared item template for any ButtonGroup whose items carry an Icon field.
export function IconButtonGroupItem(item) {
  return (
    <div className="op-icon-btn-item">
      {item.Icon && <item.Icon />}
    </div>
  );
}

export function ConfidenceIcon({ filled }) {
  const bar = n => (filled >= n ? 'currentColor' : '#e2e5ea');
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
      <rect x="0" y="11" width="5" height="7" rx="1.2" fill={bar(1)} />
      <rect x="8.5" y="6" width="5" height="12" rx="1.2" fill={bar(2)} />
      <rect x="17" y="0" width="5" height="18" rx="1.2" fill={bar(3)} />
    </svg>
  );
}

export function RiskAlertIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 1.5 18.8 16.3H1.2L10 1.5z" />
      <line x1="10" y1="7" x2="10" y2="10.8" />
      <circle cx="10" cy="13.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShieldCheckIcon() {
  return (
    <svg width="18" height="19" viewBox="0 0 18 19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.3 16 3.8v5.1c0 4.4-2.9 7.2-7 8.3-4.1-1.1-7-3.9-7-8.3V3.8L9 1.3z" />
      <path d="M5.8 9.3 8 11.5l4.2-4.6" />
    </svg>
  );
}

// Two opposing arrows — reads as "switching from one thing to another,"
// which is what a changeover actually is (grade A to grade B), rather than
// borrowing an icon meant for a different concept (a clock/duration, or a
// generic gear/settings icon that doesn't say "in transition" specifically).
function ChangeoverIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 5.5h14.5l-3.5-3.5" />
      <path d="M18.5 12.5H4l3.5 3.5" />
    </svg>
  );
}

export function TrendUpIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,14 7,7.5 11,10.5 19,1.5" />
      <polyline points="13,1.5 19,1.5 19,7.5" />
    </svg>
  );
}

export function DashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="4" y1="9" x2="14" y2="9" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Now — line status strip
// ─────────────────────────────────────────────────────────────────────────────

// One consistent visual language for all three states, rather than the old
// gauge-for-running/attention + separate duration-for-changeover split. A
// percent gauge implied a denominator worth reading closely — but with
// every running line clustered at 99-101%, that precision wasn't actually
// informative, just noisy. Icon + label reads faster at a glance anyway.
export function NowStatusIcon({ state }) {
  if (state === 'attention') return <RiskAlertIcon />;
  if (state === 'changeover') return <ChangeoverIcon />;
  return <ShieldCheckIcon />;
}

// Filled circle = always, half-filled = sometimes, outline only = never —
// click cycles through the three. currentColor stroke matches the other
// inline icons in this file (VisualizationRailIcon etc.), so it inherits text color.
export function VisibilityStateIcon({ visibility }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6" />
      {visibility === 'always' && <circle cx="8" cy="8" r="6" fill="currentColor" stroke="none" />}
      {visibility === 'sometimes' && <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" stroke="none" />}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-panel tab icons — Work / Chat / AI, icon-only (title attr for a11y)
// ─────────────────────────────────────────────────────────────────────────────

export function WorkTabIcon() {
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

export function AssetsRailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5 14 4.8V11.2L8 14.5 2 11.2V4.8Z" />
      <path d="M2 4.8 8 8 14 4.8" />
      <path d="M8 8V14.5" />
    </svg>
  );
}

export function GearIcon() {
  const toothAngles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="4.2" />
      <circle cx="8" cy="8" r="1.5" />
      {toothAngles.map(angle => (
        <rect key={angle} x="7.25" y="1.4" width="1.5" height="2.4" rx="0.4" transform={`rotate(${angle} 8 8)`} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}

// Right when collapsed, rotated to point down when expanded — CSS
// transform on the same shape rather than two separate icons.
export function CaretIcon({ expanded }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s ease' }}
    >
      <path d="M5 2.5 11 8 5 13.5" />
    </svg>
  );
}

export function PlayPauseIcon({ playing }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      {playing ? (
        <>
          <rect x="3.5" y="2.5" width="3" height="11" rx="0.8" />
          <rect x="9.5" y="2.5" width="3" height="11" rx="0.8" />
        </>
      ) : (
        <path d="M4 2.3v11.4a0.8 0.8 0 0 0 1.22 0.68l9.1-5.7a0.8 0.8 0 0 0 0-1.36l-9.1-5.7A0.8 0.8 0 0 0 4 2.3z" />
      )}
    </svg>
  );
}

export function ChatTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6.7l-2.9 2.35a.4.4 0 0 1-.65-.31V11.5h-.65a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function AiTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M8 1.4c.35 3 1.15 4.8 4.1 5.1-2.95.3-3.75 2.1-4.1 5.1-.35-3-1.15-4.8-4.1-5.1 2.95-.3 3.75-2.1 4.1-5.1z" />
      <path d="M13 9.6c.15 1.1.5 1.5 1.5 1.7-1 .2-1.35.6-1.5 1.7-.15-1.1-.5-1.5-1.5-1.7 1-.2 1.35-.6 1.5-1.7z" />
    </svg>
  );
}

// A small list-with-lines glyph — distinct from Chat's speech bubble and
// AI's sparkle, reads as "details/properties list" at a glance.
export function DetailsTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" />
      <line x1="4.5" y1="8" x2="11.5" y2="8" />
      <line x1="4.5" y1="10.5" x2="8.5" y2="10.5" />
    </svg>
  );
}

// A live-reading gauge — distinct from Attention's bell and Work's
// checklist, and consistent with this app's own recurring gauge/indicator
// visual language.
export function VisualizationRailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.8" y="1.8" width="5.2" height="5.2" rx="0.8" />
      <rect x="9" y="1.8" width="5.2" height="3.2" rx="0.8" />
      <rect x="9" y="6.6" width="5.2" height="4.4" rx="0.8" />
      <rect x="1.8" y="8.6" width="5.2" height="5.6" rx="0.8" />
    </svg>
  );
}

export function AttentionRailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.8c-2 0-3.4 1.6-3.4 3.6v2.1c0 .5-.2 1-.6 1.4L3 9.9c-.5.5-.1 1.3.6 1.3h9c.7 0 1.1-.8.6-1.3l-1-1c-.4-.4-.6-.9-.6-1.4V5.4c0-2-1.4-3.6-3.4-3.6z" />
      <path d="M6.3 12.3a1.7 1.7 0 0 0 3.4 0" />
    </svg>
  );
}
