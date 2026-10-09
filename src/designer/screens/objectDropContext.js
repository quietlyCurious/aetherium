// designer/screens/objectDropContext.js
// Carries "an object was dropped on this widget" from ScreensWorkspace down
// to every ContainerCard on the canvas without threading a prop through each
// level. Outside the editor (Runtime) there's no provider, so widgets don't
// accept drops. See ObjectDropPopover for what a drop does.

import { createContext } from 'react';

export const ObjectDropContext = createContext(null);

// The drag payload's type: JSON { typeId, key, label }.
export const OBJECT_MIME = 'application/x-aeth-object';
