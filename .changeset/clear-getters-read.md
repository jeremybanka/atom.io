---
"@atom.io/spa": patch
"@atom.io/spa-devtools": patch
"atom.io": patch
---

Rename SPA's `useValue` hook to `useGetter` to reflect that it returns a getter function and pair it with `useSetter`. Update imports and calls to `useGetter`; token and family/key overloads, store binding, and reactive behavior are unchanged. Migrate SPA devtools, examples, and published documentation, and require SPA 0.0.3 or later in SPA devtools. These breaking changes ship as patches under the 0.0.x release policy.

Restructure `useTimeline` to return a stable `TimelineControls` object instead of an accessor returning `TimelineValue`. Replace `history().at` and `history().length` with `history.getCursor()` and `history.getLength()`, and invoke commands directly as `history.undo()`, `history.redo()`, and `history.clear()`. Methods can be destructured during setup. The tracked `history.getTransaction()` reader returns an object with optional `undo` and `redo` callbacks for the adjacent transaction groups. Use `history.getTransaction().undo?.()` or `history.getTransaction().redo?.()` to retrieve and invoke the current action together; captured callbacks retain their target and leave diverged timelines unchanged.
