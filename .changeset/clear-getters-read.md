---
"@atom.io/spa": minor
"@atom.io/spa-devtools": minor
"atom.io": patch
---

Rename SPA's `useValue` hook to `useGetter` to reflect that it returns a getter function and pair it with `useSetter`. Update imports and calls to `useGetter`; token and family/key overloads, store binding, and reactive behavior are unchanged. Migrate SPA devtools, examples, and published documentation, and require SPA 0.1.x in SPA devtools.

Restructure `useTimeline` to return a stable `TimelineControls` object instead of an accessor returning `TimelineValue`. Replace `history().at` and `history().length` with `history.getCursor()` and `history.getLength()`, and invoke commands directly as `history.undo()`, `history.redo()`, and `history.clear()`. Methods can be destructured during setup. Use the tracked `canUndoTransaction()` and `canRedoTransaction()` readers to check grouped travel availability; the stable `undoTransaction()` and `redoTransaction()` commands resolve the current group at invocation and do nothing when no group is available.
