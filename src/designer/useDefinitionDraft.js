// designer/useDefinitionDraft.js
// A definition editor's working copy: edits go into `draft`, the committed
// definition stays untouched until Save, and `isDirty` says whether the two
// differ. Used by the Data Source and Query editors, which had identical
// copies of this logic.
//
// The draft resets the moment a DIFFERENT definition is selected, and it
// does so synchronously during render (React's recommended pattern for
// deriving state from a prop change) rather than in an effect. An effect
// runs after the render that has already compared the stale draft against
// the newly selected definition, giving one render where isDirty is wrongly
// true — which showed up as a false "unsaved changes" prompt when simply
// clicking between two items with no edits made.
//
// onDirtyChange is called whenever isDirty flips, so the workspace can mark
// the list row and the title-bar Save as the user types (a ref alone would
// not re-render the parent).

import { useState, useEffect } from 'react';

export function useDefinitionDraft(committed, onDirtyChange) {
  const [draft, setDraft] = useState(committed);
  const [syncedId, setSyncedId] = useState(committed.id);

  if (committed.id !== syncedId) {
    setSyncedId(committed.id);
    setDraft(committed);
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(committed);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  return { draft, setDraft, isDirty };
}
