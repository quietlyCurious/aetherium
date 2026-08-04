// expressionEval.js
// Safe client-side expression evaluator for Phase 1 data bindings.
//
// Uses the Function constructor so the expression runs without access to the
// local module scope — safer than a raw eval() call, and perfectly appropriate
// for a single-author design tool.
//
// Supported in Phase 1:
//   Literals       →  42.5   "Running"   true
//   Arithmetic     →  100 * 0.8   (42 + 58) / 2
//   String concat  →  "Status: " + "OK"
//   Ternary        →  42 > 40 ? "High" : "Low"
//   Math object    →  Math.round(42.5)   Math.max(10, 20)
//
// Returns '#ERR' on any evaluation error so widgets show a visible indicator
// rather than silently failing.

export function evaluateExpression(expression) {
  if (!expression || typeof expression !== 'string' || expression.trim() === '') {
    return undefined;
  }
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`return (${expression})`)();
  } catch {
    return '#ERR';
  }
}
