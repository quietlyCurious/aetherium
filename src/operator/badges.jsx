// operator/badges.jsx
// Small labelled badges shared across the Operator views. AiPill marks a
// value or suggestion as AI-derived rather than measured — it appears on
// attention cards, in Investigate and in the AI chat panel.

// ─────────────────────────────────────────────────────────────────────────────
// Small shared bits
// ─────────────────────────────────────────────────────────────────────────────

export function AiPill() {
  return <span className="op-ai-pill">AI</span>;
}
