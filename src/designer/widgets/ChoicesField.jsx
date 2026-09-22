// designer/widgets/ChoicesField.jsx
// An enum's choices as comma-separated text. Committed on blur or Enter
// rather than on every keystroke, so typing "a, " doesn't momentarily drop
// the entry being typed.

import { useState } from 'react';
import { parseChoices } from './widgetPropertyEdits';

export function ChoicesField({ options, onCommit }) {
  const joined = options.join(', ');
  const [text, setText] = useState(joined);
  const [seen, setSeen] = useState(joined);
  if (seen !== joined) { setSeen(joined); setText(joined); }

  const commit = () => {
    const next = parseChoices(text);
    if (next.join(', ') !== joined) onCommit(next);
    else setText(joined);
  };

  return (
    <input
      className="details-input"
      placeholder="e.g. inside, outside, center"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
    />
  );
}
