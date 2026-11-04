---
"@atom.io/spa": minor
"@atom.io/spa-devtools": minor
"atom.io": patch
---

Rename SPA's `useValue` hook to `useGetter` to reflect that it returns a getter function and pair it with `useSetter`. Update imports and calls to `useGetter`; token and family/key overloads, store binding, and reactive behavior are unchanged. Migrate SPA devtools, examples, and published documentation, and require SPA 0.1.x in SPA devtools.

Restructure `useTimeline` to return a stable `TimelineControls` object instead of an accessor returning `TimelineValue`. Replace `history().at` and `history().length` with `history.getCursor()` and `history.getLength()`, and invoke commands directly as `history.undo()`, `history.redo()`, and `history.clear()`. Methods can be destructured during setup. The tracked `undo.getTransaction()` and `redo.getTransaction()` readers return a callback capturing the adjacent transaction group, or `undefined` when none is available. Use `undo.getTransaction()?.()` and `redo.getTransaction()?.()` to retrieve and invoke the current action together; captured callbacks retain their target and leave diverged timelines unchanged.
